/**
 * שכבת השירות שמחברת הודעות נכנסות לשיחות מתמשכות.
 *
 * זה המקום המרכזי שבו: מזהים/יוצרים לקוח ושיחה, שומרים הודעות, מפעילים את
 * המוח, ושומרים את התשובה. משמש גם את ה-Playground וגם את כל הערוצים.
 * אם נציג אנושי השתלט על השיחה (status=human), הבוט שותק.
 */

import { randomUUID } from "crypto";
import { getRepo } from "./db";
import { generateReply } from "./claude";
import { loadBusinessConfig } from "./business-config-store";
import { loadMedia, isMediaRelevant, type MediaItem } from "./media-store";
import { sendEscalationEmail, sendHumanFollowUpPush, sendSystemAlarmWhatsApp } from "./alerts";
import { processGapQuestion } from "./knowledge-filter";
import {
  createReservation,
  loadReservations,
  resolveReservationDate,
  reservationDateLabel,
} from "./reservations";
import { checkReservationAvailability } from "./reservation-availability";
import { looksLikeReservationFlow, extractReservationSlots, reservationSlotsHint } from "./reservation-slots";
import { isOpenNow, israelDateISO, effectiveHoursToday } from "./business-hours";
import { isGateConfigured, gateHoursBypassed, openParkingGate } from "./palgate";
import { getTodayUsage, recordLlmUsage, recordFreeReply } from "./usage";
import type { BusinessConfig } from "./business-config";
import { AGENT_MSG_PREFIX, type Channel, type ConversationMessage } from "./channels/types";

// ביטויים שמעידים שהבוט לא ידע לענות (פער ידע) -> נרשום את שאלת הלקוח
const GAP_PATTERNS = [
  "אין לי את",
  "אין לי מידע",
  "אין לי פרט",
  "אין לי כרגע",
  "אין לי גישה",
  "אין לי את הפרט",
  "אין לי את התאריך",
  "אין לי את כל הפרט",
  "לא מופיע אצלי",
  "לא נמצא אצלי",
  "לא מצאתי",
  "כדאי לברר",
  "שווה לברר",
  "לברר עם הצוות",
  "לברר ישירות",
  "לבדוק עם הצוות",
  "לבדוק מול הצוות",
  "הצוות ישמח לספר",
  "הצוות יוכל לעדכן",
];

function detectKnowledgeGap(reply: string): boolean {
  return GAP_PATTERNS.some((p) => reply.includes(p));
}

/** דגל בזיכרון המופע: הוקפצה אזעקת מערכת? (לכיבוי אוטומטי כשהמודל מתאושש) */
let alarmRaised = false;

/**
 * רישום שאלה פתוחה דרך "המסנן החכם" (ראה knowledge-filter.ts):
 * ניסוח מקצועי, איחוד כפילויות סמנטיות, וסינון של מה שאינו שאלת ידע.
 */
async function logOpenQuestion(
  question: string,
  conversationId: string,
  askerName?: string
): Promise<void> {
  await processGapQuestion(question, {
    conversationId,
    name: askerName,
    ts: Date.now(),
  });
}

/**
 * זיהוי שפת הלקוח מהודעותיו האחרונות, כדי שגם ההודעות הקבועות שלנו (העברה לנציג,
 * תקלה, הגבלת קצב) יהיו באותה שפה - ולא "יקפצו" לעברית באמצע שיחה באנגלית.
 * שמרני בכוונה: עוברים לאנגלית רק כשאין עברית בכלל ויש מספיק טקסט לטיני.
 */
function detectLang(texts: string[]): "he" | "en" {
  const joined = texts.join(" ");
  const hebrew = (joined.match(/[֐-׿]/g) || []).length;
  const latin = (joined.match(/[A-Za-z]/g) || []).length;
  return hebrew === 0 && latin >= 4 ? "en" : "he";
}

/** שפת הלקוח לפי שלוש הודעותיו האחרונות בהיסטוריה */
function langFromHistory(history: ConversationMessage[]): "he" | "en" {
  return detectLang(
    history.filter((m) => m.role === "user").slice(-3).map((m) => m.content)
  );
}

/**
 * זיהוי זול (בלי מודל, בלי עלות) של שאלת "איפה אתם / איך מגיעים" - השאלה
 * הנפוצה ביותר. אם ההודעה קצרה, מכילה דפוס מיקום ולא שואלת שום דבר נוסף -
 * עונים מתבנית קבועה במקום להפעיל את המודל. שמרני בכוונה: כל ספק -> המודל.
 */
const LOCATION_PATTERNS: RegExp[] = [
  /איפה\s+(אתם|זה|המקום|המסעדה|הקפה|בית\s*הקפה|נמצא)/,
  /איפה.{0,8}נמצא/, // תופס גם "איפה את נמצאים", "איפה בדיוק נמצאים" וכד'
  /איפ[הוא]\s*(אתם|נ[יי]?מצא|מ[יי]?מצא|נמצט|קפה|המסעדה)/,
  /^(אשמח ל)?(מיקום|ניווט)[?!.\s]*$/,
  /היכן\s+נמצא/, // שגיאות כתיב נפוצות: "איפו אתם", "נימצאים"
  /היכן\s+(אתם|המקום|המסעדה|בית\s*הקפה|ממוקמ)/,
  /מיקום והגעה|^מיקום\s*\??$/,
  /^כתובת[?.\s]|[\s.]כתובת[?.\s]?/,
  /היכן\s+(אתם|המקום|המסעדה)/,
  /מה\s+הכתובת/,
  /^כתובת\s*\??$/,
  /איך\s+(מגיעים|להגיע|באים)/,
  /לינק\s+(הגעה|ניווט|למיקום)|קישור\s+(הגעה|ניווט|למיקום)/, // "אפשר לינק הגעה?" (ביקורת 10.8)
  /ממוקמים/,
  /^מיקום\s*\??$/,
  /where\s+are\s+you/i,
  /your\s+address/i,
  /how\s+(do\s+(i|we)|to)\s+get\s+(there|to)/i,
];
/** אם מופיע גם נושא אחר - לא עונים מתבנית (שלא נפספס חצי שאלה) */
const LOCATION_EXCLUDES =
  /(מחיר|עולה|תפריט|מנה|שעת|שעות|פתוח|סגור|להזמין|שולחן|הזמנ|אירוע|כשר|גלוטן|טבעוני|אלרגי|price|menu|open|hour|reserv)/i;

/**
 * מנוע התשובות המהירות: כל השאלות הקבועות הנפוצות (מיקום, שעות, כשרות, חניה,
 * תפריט, איך מזמינים) נענות מתבנית שנבנית מהקונפיג - בלי מודל, בעלות אפס.
 * שמרני בכוונה: הודעה קצרה, כוונה אחת בלבד, בלי מילים מנושא אחר - כל ספק -> מודל.
 */
const QUICK_MATCHERS: { key: string; patterns: RegExp[]; exclude: RegExp }[] = [
  { key: "location", patterns: LOCATION_PATTERNS, exclude: LOCATION_EXCLUDES },
  {
    key: "greet",
    // "היי" בודד / "?" - ברכה קבועה בחינם במקום קריאת מודל.
    // הורחב 22.8: שגיאות כתיב ("שלןם"), ברכה כפולה ("היי ערב טוב"), ברכות שבת וחג.
    patterns: [
      /^(היי+|הי|של[ון][םן]|אהלן|היוש|בוקר טוב|בוקר אור|ערב טוב|צהריים טובים|לילה טוב)[!.,\s]*$/,
      /^((היי+|הי|של[ון][םן]|אהלן)[!.,\s]+)(בוקר טוב|ערב טוב|צהריים טובים|בוקר אור)[!.,\s]*$/,
      /^שבת שלום( ומבורך)?[!.,\s🌷🙂]*$/,
      /^\?+$/,
    ],
    exclude: /^$/,
  },
  {
    key: "reservePolicy",
    // שאלות מדיניות הזמנה כלליות (בלי פרטי הזמנה ממשיים - אלה למודל)
    patterns: [
      /צריך להזמין (מקום )?מראש/,
      /חובה להזמין/,
      /אפשר (להזמין|לשמור) מקום מראש\??$/,
      /(אפשר|ניתן) (להזמין|לשמור) (מקום|שולחן) ל?(יום )?שישי\??$/,
    ],
    exclude: /אנשים|איש|סועדים|בשעה|\d{1,2}:\d{2}|על שם|בבוקר|בערב|בצהריים|מחר|היום|תאריך/,
  },
  {
    key: "jobs",
    patterns: [
      /מחפשים עובדים|דרושים|מגייסים|לעבוד אצלכם|להגיש מועמדות|יש משרה|משרה פנויה|משרות|מחפשת? עבודה|עבודה אצלכם|קורות חיים|קו"ח|מחפשים (מארחות|מארחים|מלצרי|מלצריות|טבחי|עובדות)/,
    ],
    exclude: /פינת עבודה|לעבוד עם מחשב|לשבת לעבוד/,
  },
  {
    key: "collab",
    // הערה: \b לא עובד עם אותיות עבריות ב-JS - משתמשים ב-lookahead "לא אות עברית"
    // כדי לתפוס 'שת"פ'/'שתפ' אבל לא מילים כמו "משתפים"
    patterns: [/שת["״']?פ(?![א-ת])/, /שיתוף פעולה/, /משפיענ/, /ימי צילום/, /סרטונים לעסקים/, /תוכן ממומן/, /ניהול סושיאל/],
    exclude: /^$/,
  },
  {
    key: "hours",
    patterns: [/מהן שעות|שעות ה?פעילות|שעות ה?פתיחה|באילו שעות|^מתי אתם פתוחים\??$/],
    // שאלות על יום/רגע ספציפי דורשות חישוב והקשר - למודל
    exclude: /היום|מחר|עכשיו|הערב|בערב|שבת|ראשון|שלישי|רביעי|חמישי|שישי|יום שני|מוצ|חג|צום|איפה|כתובת|תפריט|מחיר|עולה|הזמנ|כשר|חני/,
  },
  {
    key: "kashrut",
    // "מה ההכשר" - ניסוח וואטסאפ נפוץ (מביקורת השאלות ששולמו 10.8)
    patterns: [/מהי? (ה)?כשרות|איזו כשרות|איזה כשרות|אתם כשרים|המסעדה .{0,6}כשרה|יש (לכם )?כשרות|תעודת כשרות|מה ההכשר|איזה הכשר|^כשרות\??$/,],
    exclude: /איפה|כתובת|שעות|תפריט|מחיר|עולה|חני|הזמנ|גלוטן|טבעוני|בשר/,
  },
  {
    key: "parking",
    // הורחב 22.8: לקוחות שואלים *איפה* החניה, לא רק אם יש. 13 מקרים ששולמו.
    patterns: [
      /יש (לכם )?חני(ה|יה)|מה עם חני|חני(ה|יה) מדויקת|^חני(ה|יה)\??$/,
      /איפה (ה)?חני(ה|יה)|איפה (אפשר )?ל(ה)?חנות|היכן (ה)?חני|מחפשים? חני(ה|יה)|צריכ(ה|ים)? חני(ה|יה)|חני(ה|יה) צריכ/,
      /(קישור|לינק|מיקום) (ל)?(מקום )?חני(ה|יה)|בקשר לחני(ה|יה)|חני(ה|יה) צמודה|באיזה רחוב (ה)?חני/,
    ],
    exclude: /נכים|אופנוע|שמורה|איפה אתם|כתובת|שעות|תפריט|מחיר|עולה|הזמנ|כשר|תפתח|לפתוח|שער/,
  },
  {
    key: "instagram",
    patterns: [/יש (לכם )?(עמוד |דף )?אינסטגרם|האינסטגרם שלכם|אתם באינסטגרם/],
    exclude: /^$/,
  },
  {
    key: "menu",
    patterns: [
      /^תפריט\??$|^כן,? ?תפריט\??$|אפשר (לקבל |לראות )?(את ה)?תפריט|יש (לכם )?תפריט|שלחו? (לי )?(את ה)?תפריט|מה יש (לכם )?בתפריט/,
      // "תפריט ומחירים" לכל צורותיו - סקירת הקטגוריות עונה (כל קטגוריה נשלחת עם מחירים)
      /מה התפריט|תפריט ו?מחירים|מחירים ותפריט|אפשר מחירים|מה המחירים\??$|מחירון/,
    ],
    // כל בקשה ספציפית (קטגוריה, תזונה) - למודל שידייק. מחירי מנה בודדת -> מנוע המחירים
    exclude: /בוקר|צהריים|ערב|קינוח|פיצ|פסט|סלט|שתי|ילדים|גלוטן|טבעוני|צמחוני|כשר|כמה עולה|איפה|שעות|חני|הזמנ|אלרג/,
  },
  {
    key: "reserveHowto",
    // "איך מזמינים" = שאלת מידע. הורחב 22.8: גם כוונה גנרית בלי שום פרט
    // ("להזמין מקום", "אני רוצה להזמין מקום") - התשובה הראשונה זהה בכל מקרה
    // (שתי הדרכים + הכללים), והמודל נכנס רק בתור הבא כשיש פרטים לעבוד איתם.
    patterns: [
      /איך (אפשר )?(מזמינים|להזמין) (מקום|שולחן)|איך עושים הזמנה/,
      /^(היי[,!.\s]*)?(אני )?(רוצה |רציתי |אפשר |אשמח )?(ל?ה?זמנת|להזמין|לשריין|לסגור) (מקום|שולחן|מקומות)[?!.\s]*$/,
    ],
    exclude: /היום|מחר|הערב|שבת|אנשים|איש|זוג|יום הולדת|אירוע|\d/,
  },
  {
    key: "openNow",
    // "פתוחים עכשיו/היום" - מחושב בקוד משעון ישראל + השעות + הדריסות. חינם ומדויק.
    // הורחב 22.8: "פתוחים?" לבד, "אתם פעילים?", "פתוח עכשיו".
    patterns: [/פתוח(ים)? עכשיו/, /סגורים עכשיו/, /^(האם )?(אתם )?פתוחים\??$/, /^(אתם )?פעילים\??$/, /פתוחים היום/, /עד מתי (אתם )?פתוחים\??$/, /עד איזו? שעה (אתם )?פתוחים\??$/, /מה השעות היום/],
    exclude: /מחר|שבת|ראשון|שלישי|רביעי|חמישי|שישי|יום שני|מוצ|איפה|כתובת|תפריט|מחיר|עולה|הזמנ|כשר|חני/,
  },
  {
    key: "openTomorrow",
    patterns: [/פתוחים מחר/, /מחר פתוחים/, /מה השעות מחר/, /עד מתי מחר/, /^ומחר\??$/],
    exclude: /שבת|ראשון|שלישי|רביעי|חמישי|שישי|יום שני|מוצ|איפה|כתובת|תפריט|מחיר|עולה|הזמנ|כשר|חני/,
  },
];

/** שעות פעילות לתאריך נתון: דריסה נקודתית אם קיימת, אחרת השעות הקבועות של אותו יום */
function hoursForDateISO(cfg: BusinessConfig, iso: string): { hours: string | null; dayName: string } {
  const HE = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  const [y, m, d] = iso.split("-").map(Number);
  const dayName = HE[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const override = cfg.hoursOverrides?.find((o) => o.date === iso);
  if (override) return { hours: override.hours, dayName };
  return { hours: cfg.hours.find((h) => h.day === dayName)?.hours ?? null, dayName };
}

function tomorrowISO(): string {
  const t = new Date(israelDateISO() + "T12:00:00Z");
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

/**
 * נרמול שאלה להשוואה: מוריד ברכות פתיחה, סימני פיסוק ורווחים כפולים.
 * משמש להתאמה שמרנית מול מאגר הידע הנלמד - זהות אחרי נרמול בלבד, בלי ניחושים.
 */
function normalizeQ(s: string): string {
  return s
    .replace(/^(היי|שלום|אהלן|הי|בוקר טוב|ערב טוב)[,!.\s]+/g, "")
    .replace(/^האם\s+/, "") // "האם יש..." == "יש..."
    .replace(/יש (לכם|אצלכם)\s+/g, "יש ") // "יש לכם וויפיי" == "יש וויפיי"
    .replace(/[?!.,:;"'`()\-–—*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * ב': תשובה ישירה מהידע הנלמד - שאלה שהצוות כבר ענה עליה בפאנל נענית בחינם.
 * שמרני: רק זהות מלאה אחרי נרמול. כל ניסוח שונה -> המודל (ששולף מאותו ידע).
 */
function matchLearnedAnswer(
  raw: string,
  answered: { id: string; question: string; answer: string | null }[]
): { id: string; answer: string } | null {
  const lines = raw.split("\n").map((s) => s.trim()).filter(Boolean);
  const t = [...new Set(lines)].join(" ");
  if (!t || t.length > 90) return null;
  const norm = normalizeQ(t);
  if (norm.length < 4) return null;
  for (const qa of answered) {
    if (!qa.answer) continue;
    if (normalizeQ(qa.question) === norm) return { id: qa.id, answer: qa.answer };
  }
  return null;
}

/**
 * זיהוי הודעות פישינג/הונאה (ספאם שמתחזה למטא: "דף העסק שלך הושבת" וכו').
 * הבוט מזהה בקוד ופשוט לא עונה - אפס עלות, אפס חשיפה. שמרני: נדרשים
 * לפחות 3 סממנים + הודעה ארוכה, כדי שלקוח אמיתי לעולם לא ייחסם בטעות.
 */
const PHISHING_MARKERS: RegExp[] = [
  /דף העסק/, /הושבת|יושבת לצמיתות/, /מפרה? את מדיניות|הפרת מדיניות/, /מרכז הביקורות/,
  /תהליך אימות|אימות המידע|נדרש אימות/, /לצמיתות/, /הגבלה זמנית/, /תוך 24 שעות/,
  /נדרשת פעולה/, /קניין רוחני/, /זכויות יוצרים/,
  /verify (your )?(page|account|identity)/i, /community standards/i, /policy violation/i,
  /permanently (disabled|suspended|restricted)/i, /meta (business )?(support|team|world)/i,
];
function looksLikePhishing(text: string): boolean {
  if (!text || text.length < 60) return false;
  let score = 0;
  for (const p of PHISHING_MARKERS) if (p.test(text)) score++;
  return score >= 3;
}

/** עמוד ממותג באתר עם סרטון הדרך לחניה - לערוצים שלא מקבלים קובץ (אינסטגרם) */
const PARKING_PAGE_URL = "https://caffecavalli.com/parking";

/** ג': רמז לשאלת מחיר - בודקים מול התפריט רק כשזה מופיע */
const PRICE_HINT = /כמה עולה|מה המחיר|מחיר של/;

/**
 * ג': מחיר מנה ישירות מהתפריט - "כמה עולה X" נענה בחינם כשיש התאמה חד-משמעית
 * לפריט אחד בדיוק. עמימות (כמה פריטים), תזונה/אלרגיות, או פריט שאזל -> מודל.
 */
function menuPriceAnswer(raw: string, cfg: BusinessConfig): string | null {
  const t = raw.replace(/\s+/g, " ").trim();
  if (t.length > 60) return null;
  // שאלה משולבת עם נושא נוסף (חניה/שעות/...) או תזונתית -> מודל, שיענה על הכל
  if (/גלוטן|טבעוני|צמחוני|אלרג|כשר|בלי |ללא |ילדים|חני|שעות|פתוח|איפה|כתובת|הזמנ|תפריט|מיקום/.test(t)) return null;
  let needle: string | null = null;
  for (const p of [/כמה עולה (.+)/, /מה המחיר של (.+)/, /מחיר של (.+)/]) {
    const m = t.match(p);
    if (m) { needle = normalizeQ(m[1]); break; }
  }
  if (!needle || needle.length < 2) return null;
  const hits: { name: string; price: string; description?: string }[] = [];
  let hitName = "";
  for (const cat of cfg.menu ?? []) {
    for (const it of cat.items) {
      if (it.available === false) continue;
      const name = normalizeQ(it.name);
      if (name.includes(needle) || needle.includes(name)) {
        hits.push(it);
        hitName = name;
      }
    }
  }
  if (hits.length !== 1) return null; // לא חד-משמעי -> המודל יעזור לדייק
  // אם הלקוח כתב הרבה מעבר לשם המנה - כנראה יש שם עוד שאלה/בקשה -> מודל
  if (needle.length > hitName.length + 8) return null;
  const it = hits[0];
  const price = /^\d+([./]\d+)?$/.test(it.price.trim()) ? `₪${it.price.trim()}` : it.price;
  return `*${it.name}* - ${price}${it.description ? `\n${it.description}` : ""} 🙂`;
}

/**
 * פירוט קטגוריה מהתפריט בחינם: "מה יש בקינוחים?" / "איזה פיצות יש?" / "קינוחים".
 * התאמה חד-משמעית לקטגוריה אחת בלבד; כל בקשה ספציפית (תזונה/מחיר) -> מודל.
 */
function menuCategoryAnswer(raw: string, cfg: BusinessConfig): string | null {
  const t = raw.replace(/\s+/g, " ").trim();
  if (t.length > 40) return null;
  // "פירות" הוחרג (20.8): "קינוחי פירות" הם פריטי ויטרינה עם תשובת ידע ייעודית,
  // ורשימת הקינוחים הגנרית הייתה חוטפת את השאלה (תקרית גליה 18.8)
  if (/גלוטן|טבעוני|צמחוני|אלרג|כשר|בלי |ללא |מחיר|עולה|ילדים|איפה|שעות|חני|הזמנ|פתוח|פירות/.test(t)) return null;
  const stem = (s: string) => normalizeQ(s).replace(/(יות|ות|ים)$/, "").replace(/ה$/, "");
  let cand = t
    .replace(/^(מה יש (לכם )?ב|איזה |אילו |יש (לכם )?|תראו? לי (את )?|אפשר לראות (את )?)/, "")
    .replace(/\s*(יש|אצלכם)\s*$/, "");
  cand = normalizeQ(cand);
  if (cand.length < 3 || cand.split(" ").length > 3) return null;
  const cStem = stem(cand);
  if (cStem.length < 3) return null;
  // התאמה זהירה: שם הקטגוריה מכיל את המבוקש, או שאחת המילים המבוקשות שווה/מתחילה
  // את שם הקטגוריה. בלי containment חופשי הפוך (גרם ל"מעוניינים" לתפוס את "יין").
  const candWords = cand.split(" ").map(stem).filter((w) => w.length >= 3);
  const hits = (cfg.menu ?? []).filter((c) => {
    const n = stem(c.name);
    return n.includes(cStem) || candWords.some((w) => w === n || (n.length >= 4 && w.startsWith(n)));
  });
  if (hits.length !== 1) return null;
  const cat = hits[0];
  const items = cat.items.filter((i) => i.available !== false);
  if (!items.length) return null;
  const lines = items
    .map((i) => `- ${i.name} - ${/^\d/.test(i.price.trim()) ? "₪" + i.price.trim() : i.price}`)
    .join("\n");
  return `*${cat.name}* 🙂\n${lines}${cat.note ? `\n(${cat.note})` : ""}\n\nמשהו קורץ לך? 😋`;
}

/**
 * "תודה" וסגירות חמות - תשובת נימוס קצרה בחינם. רק ביטויי תודה מובהקים,
 * ורק כשההודעה האחרונה של הבוט לא הסתיימה בשאלה (שלא נבלע אישור באמצע זרימה).
 */
// הורחב 22.8 (ביקורת: 18 מקרים ששולמו): "אוקיי" בשתי יו"דים, נקודה אחרי "אוקי",
// "טוב תודה", כל אימוג'י (כולל מודיפייר גוון עור U+1F3FB-FF), ו-ack באנגלית.
const ACK_EMOJI = "\\p{Extended_Pictographic}\\p{Emoji_Component}";
const ACK_RX = new RegExp(
  `^((אוקי+|טוב|יפי|מעולה|אחלה|סבבה|רב|המון|יאללה)[,!.\\s]+)*` +
    `(תודה|תוגה|תודות|תודהה+)( רבה| רבות)?( לך| לכם| מראש| מקרב לב)?` +
    `[!.,\\s${ACK_EMOJI}]*$` +
    // אישור חשוף בלי "תודה" ("אוקיי", "אוקי.", "סבבה") - ההודעה כולה היא המילה
    `|^(אוקי+|סבבה|אחלה|יאללה|מעולה)[!.,\\s${ACK_EMOJI}]*$` +
    // אנגלית: "thanks", "thank you", "noted thank you", "ok thanks"
    `|^(ok(ay)?[,!.\\s]+)?(noted[,!.\\s]*)?(thanks?( you)?|thank you)[!.,\\s${ACK_EMOJI}]*$` +
    // אימוג'י בלבד
    `|^[\\s${ACK_EMOJI}]+$`,
  "iu"
);
const ACK_REPLIES = ["בשמחה! 🙂", "בכיף! מחכים לכם ☕", "תמיד 🙂 נתראה!"];

/**
 * מזהה שאלות קבועות: מחזיר 0, 1 או 2 מפתחות.
 * שני מפתחות = הלקוח לחץ על שני כפתורים שונים ברצף (מוזגו לצרור) - עונים על שניהם בחינם.
 */
function matchQuickAnswers(raw: string): string[] {
  // לחיצות כפולות על אותו כפתור מגיעות כשורות זהות - מאחדים לפני הבדיקה
  const lines = [...new Set(raw.split("\n").map((s) => s.trim()).filter(Boolean))];
  const t = lines.join("\n");
  if (!t) return [];
  // מגבלת אורך: פניות ספאם/שת"פ/דרושים ארוכות מטבען (ביקורת 22.8 מצאה פניית
  // שת"פ בת 218 תווים שנחסמה רק בגלל האורך ועלתה כסף) - להן אין תקרה.
  const LONG_OK = /שת["״']?פ(?![א-ת])|שיתוף פעולה|משפיענ|ניהול סושיאל|תוכן ממומן|קורות חיים|דרושים|מחפשים עובדים|לעבוד אצלכם/;
  if (t.length > 90 && !(LONG_OK.test(t) && t.length <= 600)) return [];
  const matchOne = (s: string): string | null => {
    // נרמול לפני ההשוואה (22.8): "האם יש אצלכם חניה" נכשל בעבר רק כי התבניות
    // בדקו "יש חניה". normalizeQ מסיר ברכת פתיחה, "האם", ו"יש לכם/אצלכם".
    const cands = [s, normalizeQ(s)];
    const hits = QUICK_MATCHERS.filter((q) => q.patterns.some((p) => cands.some((c) => p.test(c))));
    if (hits.length !== 1) return null;
    if (cands.some((c) => hits[0].exclude.test(c))) return null;
    return hits[0].key;
  };
  const single = matchOne(t);
  if (single) return [single];
  if (lines.length === 2) {
    const a = matchOne(lines[0]);
    const b = matchOne(lines[1]);
    if (a && b && a !== b) return [a, b];
  }
  return [];
}

/** בונה את תשובת התבנית לפי המפתח. null = אין נתונים / שפה לא נתמכת -> מודל. */
function buildQuickAnswer(
  key: string,
  cfg: BusinessConfig,
  lang: "he" | "en",
  hasParkingVideo: boolean
): string | null {
  if (key === "location") return locationCannedReply(cfg, lang, hasParkingVideo);
  if (lang === "en") return null; // שאר התבניות בעברית; אנגלית -> מודל
  switch (key) {
    case "hours": {
      const week = cfg.hours.map((h) => `- ${h.day}: ${h.hours ?? "סגור"}`).join("\n");
      const today = israelDateISO();
      const upcoming = (cfg.hoursOverrides ?? [])
        .filter((o) => o.date >= today)
        .sort((a, b) => a.date.localeCompare(b.date));
      // "שימו לב" אחד לכל התאריכים: ימים עם אותן שעות מקובצים יחד
      // ("בתאריכים 28.7 ו-30.7 פתוחים 08:00-16:30"), שעות שונות מופרדות ב", ו".
      let specials = "";
      if (upcoming.length) {
        const fmtD = (iso: string) => {
          const [, m, d] = iso.split("-").map(Number);
          return `${d}.${m}`;
        };
        const groups = new Map<string, { dates: string[]; note?: string }>();
        for (const o of upcoming) {
          const key = o.hours ?? "__closed__";
          const g = groups.get(key) ?? { dates: [], note: o.note };
          g.dates.push(fmtD(o.date));
          groups.set(key, g);
        }
        const joinDates = (ds: string[]) =>
          ds.length === 1 ? `בתאריך ${ds[0]}` : `בתאריכים ${ds.slice(0, -1).join(", ")} ו-${ds[ds.length - 1]}`;
        const notes = [...new Set(upcoming.map((o) => o.note).filter(Boolean))];
        const singleNote = notes.length === 1;
        const parts = [...groups.entries()].map(([hours, g]) => {
          const what = hours === "__closed__" ? "סגור" : `פתוחים ${hours}`;
          const perNote = !singleNote && g.note ? ` (${g.note})` : "";
          return `${joinDates(g.dates)} ${what}${perNote}`;
        });
        specials = `\n\nשימו לב: ${parts.join(", ו")}${singleNote ? ` (${notes[0]})` : ""}`;
      }
      return `שעות הפעילות שלנו:\n${week}${specials}\n\nמחכים לכם! ☕`;
    }
    case "kashrut":
      return cfg.kashrut ? `${cfg.kashrut} 🙂` : null;
    case "greet":
      return `איך אפשר לעזור? 🙂 תפריט, שעות, הזמנת מקום או כל שאלה אחרת - אני כאן.`;
    case "reservePolicy":
      // שני הכללים המלאים תמיד יחד - שלא ישתמע ש"בערב אפשר" גם בשישי
      return (
        `שמחים שאתם מתכננים להגיע! 🙂 ככה זה עובד אצלנו:\n` +
        `- בימים שני-חמישי אפשר להזמין מקום מראש לשעות הערב (מ-18:00). בשעות היום מגיעים בלי הזמנה - על בסיס מקום פנוי.\n` +
        `- ביום ראשון אנחנו פתוחים עד 18:00, ולכן אין בו הזמנות ערב - מגיעים במהלך היום על בסיס מקום פנוי.\n` +
        `- ביום שישי לא ניתן להזמין מקום בכלל - מגיעים ויושבים על בסיס מקום פנוי (פתוחים עד 15:00). בשבת סגור.\n\n` +
        `רוצים לשריין שולחן לערב? אפשר ממש כאן בצ'אט 🙂`
      );
    case "jobs":
      return (
        `איזה כיף שמתעניינים להצטרף אלינו! 🙂 אני מעביר את הפנייה לצוות - ` +
        `אפשר להשאיר כאן שם, טלפון וכמה מילים על ניסיון, והם יחזרו אליך.`
      );
    case "instagram":
      return `בטח! תמצאו אותנו באינסטגרם 🙂\nhttps://www.instagram.com/caffe.cavalli.il`;
    case "collab":
      // מדיניות (7.8): לא עושים שת"פים כרגע - דחייה מנומסת, בלי להעביר לצוות
      return (
        `תודה רבה על הפירגון והפנייה! 🙏\n` +
        `כרגע אנחנו לא עושים שיתופי פעולה או עבודה עם מנהלי סושיאל - יש לנו צוות מקצועי שמטפל בזה.\n` +
        `ובכל מקרה, נשמח לארח אתכם אצלנו 🤍`
      );
    case "parking": {
      if (!cfg.parking?.available || !cfg.parking.summary) return null;
      const nav = cfg.contact.navigationUrl ? `\nניווט ישיר אלינו: ${cfg.contact.navigationUrl}` : "";
      const video = hasParkingVideo ? "\nמצרף סרטון קצר שמראה בדיוק איך מגיעים אליה 🙂" : "";
      return `${cfg.parking.summary}${nav}${video}`;
    }
    case "menu": {
      if (!cfg.menu?.length) return null;
      const cats = cfg.menu.map((c) => `- ${c.name}`).join("\n");
      return `בשמחה! אלו הקטגוריות בתפריט שלנו:\n${cats}\n\nכתבו לי שם של קטגוריה (למשל "קינוחים") ואפרט את המנות והמחירים 🙂`;
    }
    case "openNow": {
      const open = isOpenNow(cfg);
      const today = effectiveHoursToday(cfg);
      const tom = hoursForDateISO(cfg, tomorrowISO());
      const tomLine = `מחר (${tom.dayName}): ${tom.hours ?? "סגור"}`;
      if (open) return `כן, אנחנו פתוחים עכשיו 🙂 היום: ${today}.\n${tomLine}.\nמחכים לכם! ☕`;
      return `${today ? `כרגע אנחנו סגורים - היום פתוחים ${today}` : "היום אנחנו סגורים"}.\n${tomLine}.\nנשמח לראותכם! 🙂`;
    }
    case "openTomorrow": {
      const tom = hoursForDateISO(cfg, tomorrowISO());
      return tom.hours
        ? `מחר (${tom.dayName}) אנחנו פתוחים ${tom.hours} 🙂 מחכים לכם! ☕`
        : `מחר (${tom.dayName}) אנחנו סגורים 🙂`;
    }
    case "reserveHowto": {
      // בלי הפניה לוואטסאפ: הלקוח כבר מדבר איתנו כאן, וזה אותו מענה בכל הערוצים
      const ways = [
        cfg.contact.reservationUrl ? `- אונליין: ${cfg.contact.reservationUrl}` : "",
        cfg.contact.phone ? `- בטלפון: ${cfg.contact.phone}` : "",
        `- או פשוט כאן בצ'אט 🙂 כתבו לי כמה תהיו ומתי, ואעביר את הבקשה לצוות`,
      ].filter(Boolean).join("\n");
      return `אפשר להזמין מקום בכמה דרכים:\n${ways}\n\nכדאי לדעת: הזמנות מראש הן לשעות הערב (מ-18:00) בימים שני-חמישי. בימי ראשון (שנסגרים ב-18:00), בשעות היום ובימי שישי מגיעים בלי הזמנה - על בסיס מקום פנוי 🙂`;
    }
  }
  return null;
}

/**
 * תשובת המיקום הקבועה - נבנית מהקונפיג (כתובת/וויז ניתנים לעריכה בפאנל).
 * כמה נוסחים והגרלה ביניהם, כדי שלקוחות חוזרים לא יקבלו תמיד מילה-במילה
 * את אותו משפט. withVideo מוסיף שורה שמכריזה על סרטון הדרך לחניה.
 */
function locationCannedReply(cfg: BusinessConfig, lang: "he" | "en", withVideo: boolean): string {
  const addr = cfg.contact.address ?? "";
  const nav = cfg.contact.navigationUrl;
  if (lang === "en") {
    const navEn = nav ? `\nWaze: ${nav}` : "";
    const videoEn = withVideo ? "\nAttaching a short video showing the way to the parking 🎥" : "";
    const en = [
      `We're at *${addr}* 🙂${navEn}\nThere's free parking right next to the cafe.${videoEn}\nSee you soon! ☕`,
      `Happy to help! You'll find us at *${addr}* 📍${navEn}\nFree parking is right next to us.${videoEn}\nSee you! ☕`,
    ];
    return en[Math.floor(Math.random() * en.length)];
  }
  // שורת הזמנה להמשך שיחה (אישר בעל העסק) - מוגרלת בנפרד מהתבנית, לגיוון
  const cta = [
    "אם תרצו עוד משהו - תפריט, שעות, או להזמין מקום - אני כאן 🙂",
    "צריכים עוד משהו? תפריט, שעות, הזמנת מקום - שאלו אותי בכיף 🙂",
    "ואפשר לשאול אותי כאן גם על התפריט, השעות, או להזמין מקום 🙂",
  ][Math.floor(Math.random() * 3)];
  // הנוסחים המדויקים שבעל העסק הגדיר. משפט הסרטון נכלל רק כשבאמת מצורף סרטון.
  const he = [
    `אנחנו נמצאים ב-*${addr}.*${nav ? `\n\nלניווט ישיר דרך Waze:\n${nav}` : ""}\n\nיש חניה חינמית צמודה למסעדה, אבל הכניסה אליה קצת נסתרת.${withVideo ? " מצרף לך סרטון קצר שיעזור לך למצוא אותה בקלות 🙂" : ""}`,
    `הכתובת היא *${addr}.*${nav ? `\n\nאפשר לנווט אלינו בקלות דרך הקישור:\n${nav}` : ""}\n\nיש חניה חינמית ממש ליד המסעדה.${withVideo ? " היא קצת מוסתרת, אז אני שולח לך גם סרטון שמראה בדיוק מאיפה נכנסים." : ""}`,
    `המסעדה נמצאת ב-*${addr} 📍*${nav ? `\n\nניווט ישיר ב-Waze:\n${nav}` : ""}\n\nיש חניה חינמית בצמוד למסעדה.${withVideo ? " הכניסה אליה מעט מוסתרת, ולכן מצרף לך סרטון קצר עם הסבר איך להגיע 🙂" : ""}`,
  ];
  return `${he[Math.floor(Math.random() * he.length)]}\n\n${cta}`;
}

/** מנסח הודעת העברה לאדם, לפי שעות הפעילות ושפת הלקוח. ב-firstTurn שוזר גילוי AI. */
function buildHandoffMessage(
  firstTurn: boolean,
  config: BusinessConfig,
  lang: "he" | "en" = "he"
): string {
  const phone = config.contact.phone;
  if (lang === "en") {
    const phoneLine = phone ? ` You can also call us at ${phone}.` : "";
    const body = isOpenNow(config)
      ? `connecting you with a member of our team, and they'll get back to you right here shortly.${phoneLine}`
      : `passing your message on to our team. We're currently closed, so they'll get back to you during opening hours.${phoneLine}`;
    if (firstTurn) {
      return `I'm the digital assistant of ${config.name}, and I'm ${body}`;
    }
    return `Got it 🙋 I'm ${body}`;
  }
  const phoneLine = phone ? ` אפשר גם להתקשר ל-${phone}.` : "";
  const body = isOpenNow(config)
    ? `מעביר אותך לנציג אנושי מהצוות, והוא יחזור אליך כאן בהקדם.${phoneLine}`
    : `מעביר את פנייתך לצוות. אנחנו כרגע סגורים, אז הם יחזרו אליך בשעות הפעילות.${phoneLine}`;
  if (firstTurn) {
    return `אני העוזר הדיגיטלי של ${config.name}, ואני ${body}`;
  }
  return `הבנתי 🙋 אני ${body}`;
}

const HISTORY_LIMIT = 12;
// חלון מורחב לשיחות שנציג היה מעורב בהן (ראה בניית ההיסטוריה)
const HISTORY_LIMIT_AFTER_AGENT = 24;

// טיפול ברצף הודעות + הגבלת קצב
const DEBOUNCE_MS = 500; // המתנה קצרה לראות אם המשתמש שולח עוד הודעה (קצר = מענה מהיר יותר)
const RATE_PER_MIN = 15;
const RATE_PER_HOUR = 50;
// כל כמה זמן מותר לשלוח הודעת "קיבלתי הרבה הודעות" לאותה שיחה (כדי לא לספמם בחזרה)
const RATE_NOTICE_COOLDOWN_MS = 90_000;
const rateNoticeAt = new Map<string, number>();

// ----- שער החניה: מגבלת פתיחות ללקוח (מונע שימוש לרעה; לקוח אמיתי לא צריך יותר) -----
const GATE_MAX_PER_HOUR = 4;

// אישורי פתיחת שער - מגוון ניסוחים נייטרליים (בלי להניח אם הלקוח נכנס או יוצא),
// מוגרלים כדי שלא יהיה תמיד אותו משפט.
const GATE_OPEN_CONFIRMATIONS_HE = [
  "פתחתי לך את השער 🙂",
  "השער פתוח 🙂",
  "הנה, פתחתי לך את השער ✅",
  "בוצע - פתחתי לך את השער 🙂",
  "פתחתי לך אותו עכשיו 🙂",
  "השער פתוח, שיהיה לך יום טוב 🙂",
  "פתחתי, סע בזהירות 🙂",
];
const GATE_OPEN_CONFIRMATIONS_EN = [
  "The gate is open 🙂",
  "Done - I've opened the gate for you 🙂",
  "There you go, the gate is open ✅",
  "I've opened the gate for you 🙂",
  "Opened - have a great day 🙂",
];

// ----- תקרת שימוש יומית גלובלית: רשת ביטחון קשיחה מפני עלות בורחת -----
// גבוה בהרבה מנפח אמיתי של בית קפה, כך שנוגעים בזה רק בתקיפה/תקלה.
// כשעוברים אותה הבוט שותק וההודעות ממתינות לצוות בפאנל (כמו כפתור הכיבוי).
const DAILY_REPLY_CAP = Number(process.env.DAILY_REPLY_CAP ?? 500);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * האם הגיעה הודעת לקוח חדשה יותר (כדי לדעת אם הקריאה הזו "הוחלפה" ע"י חדשה).
 * שובר-שוויון לפי מזהה: שתי הודעות שנוחתות באותה מילישנייה (לחיצה כפולה בו-זמנית)
 * חייבות להסתדר בסדר עקבי, אחרת שתי הקריאות עונות במקביל -> תשובה כפולה ללקוח.
 */
async function hasNewerUserMessage(
  conversationId: string,
  afterTs: number,
  myId?: string
): Promise<boolean> {
  const msgs = await getRepo().getMessages(conversationId);
  return msgs.some(
    (m) =>
      m.role === "user" &&
      (m.ts > afterTs || (myId !== undefined && m.id !== myId && m.ts === afterTs && m.id > myId))
  );
}

/** ממזג הודעות רצופות מאותו תפקיד להודעה אחת (רצף הודעות לקוח = תור אחד) */
function mergeConsecutive(
  history: ConversationMessage[]
): ConversationMessage[] {
  const out: ConversationMessage[] = [];
  for (const m of history) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += "\n" + m.content;
    else out.push({ ...m });
  }
  // המודל מצפה שההיסטוריה תתחיל בהודעת לקוח
  while (out.length && out[0].role === "assistant") out.shift();
  return out;
}

/**
 * מזהה בקשה מפורשת לפתוח את שער החניה (זיהוי דטרמיניסטי בקוד).
 * למה בקוד ולא דרך המודל: פתיחת שער היא פעולה פיזית, והמודל לפעמים מסרב לבד
 * כשהוא "חושב" שסגור (שישי בלילה) בלי לקרוא לכלי. הקוד אמין ב-100% ואוכף שעות בעצמו.
 * שמרני: חייב אזכור "שער"/gate + פועל בקשת-פתיחה מפורש, והודעה קצרה. כל ספק -> מודל.
 */
function isGateOpenRequest(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 120) return false;
  // הרחבה 22.8 (ביקורת עלות ואיכות): לקוחות רבים לא כותבים "שער" בכלל -
  // "תפתח לי", "אפשר לפתוח את החניה?", "افتحلي". הדרישה עכשיו היא פועל
  // פתיחה מפורש בגוף ראשון/ציווי, ואם מוזכר אובייקט - שיהיה שער/חניה בלבד.
  const gateWord = /שער|gate|חני|بوابة|كراج|الباب/i.test(t);
  // ערבית: "افتحلي" (פתח לי) היא בקשה מפורשת בפני עצמה
  if (/افتح\s*لي|افتحلي|افتحولي/.test(t)) return true;
  // אזכור אובייקט אחר שהופך את "לפתוח" למשהו אחר (דלת, חשבון, קופה, עסק)
  const otherObject = /דלת|חשבון|קופה|עסק|תיק|מסעדה חדשה|סניף/i.test(t);
  if (otherObject && !gateWord) return false;
  // ה-lookbehind (?<![א-ת]) דורש שהפועל יהיה בתחילת מילה - כדי לא לתפוס
  // "נפתח" (סביל, "השער לא נפתח") או "מתפתח" בטעות כבקשת פתיחה.
  const explicitVerb =
    /(?<![א-ת])(תפתח[יו]?|פתחו? את|פתחו? לי|פתחו? לנו|לפתוח (את|לי|לנו))|אפשר לפתוח|תוכל[וי]? לפתוח|\bopen\b|افتح/i.test(t);
  if (!explicitVerb) return false;
  // בלי מילת שער/חניה מפורשת נדרשת גם פנייה אישית ("לי"/"לנו") כדי לא לתפוס
  // "אפשר לפתוח חלון?" או שיחה כללית על פתיחה.
  return gateWord || /(?<![א-ת])(לי|לנו)(?![א-ת])/.test(t);
}

/**
 * זרימת פתיחת השער: בדיקת שעות (עם מתג עקיפה זמני), מגבלת קצב, פתיחה בפועל, תיעוד,
 * והסלמה בכשל. משמשת גם את הנתיב הדטרמיניסטי (בקשה מפורשת) וגם את נתיב המודל.
 * מבצעת את תופעות הלוואי (הודעות מערכת/הסלמה) אך *לא* שומרת את הודעת ה-assistant
 * הסופית - הקורא עושה זאת (וגם מטפל בגילוי ה-AI בתור ראשון).
 */
async function runGateOpen(opts: {
  repo: ReturnType<typeof getRepo>;
  conversationId: string;
  cfg: BusinessConfig;
  customerId: string;
  customerName?: string;
  channel: Channel;
  gLang: "he" | "en";
  priorMessages: Array<{ meta?: Record<string, unknown>; ts: number }>;
  modelReply: string;
}): Promise<{ reply: string; status: "bot" | "human" }> {
  const { repo, conversationId, cfg, customerId, customerName, channel, gLang, priorMessages, modelReply } = opts;
  const phone = cfg.contact.phone;

  // מחוץ לשעות הפעילות (אלא אם מתג העקיפה דלוק) - השער לא נפתח.
  if (!gateHoursBypassed() && !isOpenNow(cfg)) {
    const today = effectiveHoursToday(cfg);
    console.log(`[GATE] נחסם: מחוץ לשעות הפעילות. conv=${conversationId}`);
    return {
      reply:
        gLang === "en"
          ? `Opening the parking gate is only possible during opening hours 🙏${today ? ` Today we're open ${today}.` : " We're closed today."}`
          : `פתיחת שער החניה אפשרית רק בשעות הפעילות 🙏${today ? ` היום אנחנו פתוחים ${today}.` : " היום אנחנו סגורים."}`,
      status: "bot",
    };
  }

  // מגבלת פתיחות לשעה (הגנה מפני שימוש לרעה; לקוח אמיתי לא צריך יותר)
  const opensLastHour = priorMessages.filter(
    (m) => m.meta?.gateOpened === true && m.ts > Date.now() - 3_600_000
  ).length;
  if (opensLastHour >= GATE_MAX_PER_HOUR) {
    console.log(`[GATE] נחסם: חריגה ממגבלת פתיחות (${opensLastHour}/שעה). conv=${conversationId}`);
    await repo.addMessage({
      conversationId,
      role: "system",
      content: `🅿️ בקשת פתיחת שער נחסמה - חריגה ממגבלת הפתיחות (${opensLastHour} בשעה האחרונה)`,
      ts: Date.now(),
      meta: { activity: true, gateBlocked: true },
    });
    return {
      reply:
        gLang === "en"
          ? `I've already opened the gate several times in the last hour, so I'm pausing for safety 🙏 Our team can help${phone ? ` at ${phone}` : ""}.`
          : `פתחתי כבר את השער כמה פעמים בשעה האחרונה, אז אני עוצר ליתר ביטחון 🙏 הצוות ישמח לעזור${phone ? ` בטלפון ${phone}` : ""}.`,
      status: "bot",
    };
  }

  try {
    await openParkingGate();
    const bypassNote = gateHoursBypassed() && !isOpenNow(cfg) ? " (עקיפת שעות זמנית - מצב הקמה)" : "";
    console.log(`[GATE] השער נפתח${bypassNote}. conv=${conversationId} customer=${customerId}`);
    await repo.addMessage({
      conversationId,
      role: "system",
      content: `🅿️ שער החניה נפתח לבקשת הלקוח${bypassNote}`,
      ts: Date.now(),
      meta: { activity: true, gateOpened: true },
    });
    // אישור ברור ומגוון ללקוח, נייטרלי (בלי "להיכנס"/"לצאת" - לא יודעים לאיזה כיוון).
    // אם למודל (בנתיב הגיבוי) כבר יש ניסוח שמזכיר שער - שומרים אותו.
    const heConfirm = GATE_OPEN_CONFIRMATIONS_HE[Math.floor(Math.random() * GATE_OPEN_CONFIRMATIONS_HE.length)];
    const enConfirm = GATE_OPEN_CONFIRMATIONS_EN[Math.floor(Math.random() * GATE_OPEN_CONFIRMATIONS_EN.length)];
    const reply = /שער|gate/i.test(modelReply) ? modelReply : gLang === "en" ? enConfirm : heConfirm;
    return { reply, status: "bot" };
  } catch (err) {
    // הלקוח עומד עכשיו מול שער סגור - תקלה דחופה: מסלימים לצוות מיד
    console.error("[GATE] פתיחת השער נכשלה:", err);
    const gateSummary = "לקוח מחכה בכניסה לחניה והשער לא נפתח אוטומטית - צריך לפתוח לו ידנית";
    await repo.updateConversation(conversationId, {
      status: "human",
      escalated: true,
      escalationReason: "תקלה בפתיחת שער החניה",
      escalationSummary: gateSummary,
      meta: { urgent: true },
    });
    await repo.addMessage({
      conversationId,
      role: "system",
      content: `🅿️ פתיחת שער החניה נכשלה - הוסלם לנציג\nשגיאה: ${err instanceof Error ? err.message.slice(0, 180) : String(err).slice(0, 180)}`,
      ts: Date.now(),
      meta: { escalation: true, gateError: true, summary: gateSummary },
    });
    sendEscalationEmail({
      customerName,
      channel,
      reason: "תקלה בפתיחת שער החניה",
      summary: gateSummary,
      urgent: true,
      conversationId,
    }).catch(() => {});
    return {
      reply:
        gLang === "en"
          ? `I couldn't open the gate just now 🙏 I've alerted our team - they'll help right away.${phone ? ` You can also call ${phone}.` : ""}`
          : `לא הצלחתי לפתוח את השער כרגע 🙏 עדכנתי את הצוות שיעזרו מיד.${phone ? ` אפשר גם להתקשר ל-${phone}.` : ""}`,
      status: "human",
    };
  }
}

export interface HandleInput {
  channel: Channel;
  /** מזהה ייחודי של המשתמש בתוך הערוץ (טלפון / PSID / clientId בדפדפן) */
  channelUserId: string;
  text: string;
  /** מזהה שיחה אם ידוע (כדי להמשיך שיחה קיימת) */
  conversationId?: string;
  customerName?: string;
  /** מזהה ההודעה המקורי בערוץ (mid) - לדה-דופ מפני webhook כפול/retry */
  messageId?: string;
  /** פונקציה לשליפת שם המשתמש מהערוץ (נקראת רק אם אין עדיין שם שמור) */
  resolveName?: () => Promise<string | undefined>;
  /** מטא-דאטה להודעה, למשל { transcribedFromVoice: true } */
  meta?: Record<string, unknown>;
}

export interface HandleResult {
  conversationId: string;
  /** התשובה של הבוט, או null אם נציג אנושי מטפל בשיחה */
  reply: string | null;
  status: "bot" | "human" | "closed";
  /** מדיה לשליחה (אם הבוט בחר לצרף תמונה/סרטון) */
  media?: { url: string; type: "image" | "video" }[];
}

// דה-דופ סינכרוני בזיכרון: חוסם עיבוד כפול של אותה הודעה (mid) באותו instance,
// גם במרוץ מקבילי - כי הבדיקה+ההוספה סינכרוניות (בלי await ביניהן). משלים את
// הדה-דופ במסד הנתונים (שמכסה מקרים בין-instance).
const recentMids = new Set<string>();
function alreadyHandled(mid?: string): boolean {
  if (!mid) return false;
  if (recentMids.has(mid)) return true;
  recentMids.add(mid);
  if (recentMids.size > 1000) recentMids.delete(recentMids.values().next().value as string);
  return false;
}

export async function handleIncomingMessage(
  input: HandleInput
): Promise<HandleResult> {
  // חסימת כפילות מיידית (webhook כפול / retry של מטא) - לפני כל פעולה אסינכרונית
  if (alreadyHandled(input.messageId)) {
    return { conversationId: input.conversationId ?? "", reply: null, status: "bot" };
  }

  const repo = getRepo();
  const customerId = `${input.channel}:${input.channelUserId}`;

  // upsert הלקוח ואיתור השיחה אינם תלויים זה בזה (ה-customerId מחושב ישירות),
  // אז מריצים אותם במקביל כדי לחסוך סבב הלוך-ושוב למסד הנתונים (מענה מהיר יותר).
  // מציאת שיחה: לפי מזהה אם ניתן, אחרת לפי הלקוח (חשוב לרצף הודעות בלי מזהה,
  // למשל בוואטסאפ ששם המפתח הוא הלקוח). כך הודעות עוקבות מאותו אדם נכנסות לאותה שיחה.
  const [customer, foundConversation] = await Promise.all([
    repo.upsertCustomer({
      id: customerId,
      channel: input.channel,
      channelUserId: input.channelUserId,
      name: input.customerName,
    }),
    input.conversationId
      ? repo.getConversation(input.conversationId)
      : repo.listConversations().then((all) => {
          // חלון אחד לכל לקוח: קודם שיחה פתוחה, ואם אין - השיחה האחרונה שנסגרה
          // (הרשימה ממוינת לפי עדכון אחרון), והיא תיפתח מחדש למטה.
          const mine = all.filter((c) => c.customerId === customerId);
          return mine.find((c) => c.status !== "closed") ?? mine[0] ?? null;
        }),
  ]);

  let conversation = foundConversation;
  if (!conversation) {
    conversation = await repo.createConversation({
      id: input.conversationId ?? randomUUID(), // מכבד מזהה שנוצר אצל הלקוח (Playground)
      channel: input.channel,
      customerId,
      status: "bot",
    });
  } else if (conversation.status === "closed") {
    // שיחה סגורה לא פותחת חלון חדש בפאנל - היא נפתחת מחדש באותו חלון, עם קו
    // מפריד ביומן, כך שכל ההיסטוריה של הלקוח נשארת במקום אחד.
    conversation =
      (await repo.updateConversation(conversation.id, {
        status: "bot",
        escalated: false,
        escalationReason: undefined,
        escalationSummary: undefined,
        botPaused: false,
        meta: undefined, // מנקה דגלי פרק קודם (למשל "דחוף" מתקלת שער)
      })) ?? conversation;
    await repo.addMessage({
      conversationId: conversation.id,
      role: "system",
      content: "🔄 הלקוח חזר - השיחה נפתחה מחדש",
      ts: Date.now(),
      meta: { activity: true, reopened: true },
    });
  }

  // דה-דופ: אם כבר עיבדנו הודעה עם אותו mid (webhook כפול / retry של מטא), דלג
  if (input.messageId) {
    const existing = await repo.getMessages(conversation.id);
    if (existing.some((m) => m.meta?.mid === input.messageId)) {
      return { conversationId: conversation.id, reply: null, status: conversation.status };
    }
  }

  // שמירת הודעת המשתמש (כולל ה-mid לדה-דופ עתידי). שומרים את המזהה שנוצר
  // כשובר-שוויון למרוץ של שתי הודעות באותה מילישנייה (לחיצה כפולה בו-זמנית).
  const myTs = Date.now();
  const myMsg = await repo.addMessage({
    conversationId: conversation.id,
    role: "user",
    content: input.text,
    ts: myTs,
    meta: input.messageId ? { ...(input.meta || {}), mid: input.messageId } : input.meta,
  });

  // אם נציג אנושי מטפל בשיחה (או שהבוט הושהה לה) - הבוט שותק, אבל הצוות מקבל
  // פוש על כל הודעת המשך של הלקוח: בלעדיו יש התראה רק ברגע ההסלמה, וכל מה
  // שהלקוח כותב אחרי המענה הראשוני "נבלע" עד שנציג במקרה פותח את הפאנל
  // (בקשת משתמש 24.8). tag פר-שיחה מונע הצפה ברצף הודעות.
  if (conversation.status === "human" || conversation.botPaused) {
    sendHumanFollowUpPush({
      conversationId: conversation.id,
      channel: input.channel,
      customerName: customer.name,
      text: input.text,
    }).catch(() => undefined);
    return { conversationId: conversation.id, reply: null, status: conversation.status };
  }

  // כפתור כיבוי גלובלי + תקרת שימוש יומית - נקראים במקביל (בלי להוסיף זמן תגובה)
  const [botEnabledRaw, todayUsage] = await Promise.all([
    repo.getSetting("bot_enabled"),
    getTodayUsage(),
  ]);
  if (botEnabledRaw === "false") {
    return { conversationId: conversation.id, reply: null, status: conversation.status };
  }
  const usedToday = todayUsage.replies;
  if (usedToday >= DAILY_REPLY_CAP) {
    // עברנו את התקרה היומית - הבוט שותק וההודעה ממתינה לצוות בפאנל.
    console.error(
      `[DAILY_CAP] נעצר: ${usedToday}/${DAILY_REPLY_CAP} תשובות היום. ההודעות ממתינות לצוות.`
    );
    return { conversationId: conversation.id, reply: null, status: conversation.status };
  }

  // הודעת פישינג/ספאם: מזהים בקוד ולא עונים בכלל (חבל על כל אגורה ועל כל מילה).
  // השיחה נסגרת כדי שלא תופיע כ"ממתינה למענה" אצל הצוות; נשארת רשומה עם הסבר.
  if (looksLikePhishing(input.text)) {
    console.log(`[PHISHING] הודעה חשודה - הבוט שותק. conv=${conversation.id}`);
    await repo.addMessage({
      conversationId: conversation.id,
      role: "system",
      content: "🛡️ ההודעה זוהתה כניסיון פישינג/ספאם - הבוט לא הגיב והשיחה נסגרה אוטומטית",
      ts: Date.now(),
      meta: { phishing: true },
    });
    await repo.updateConversation(conversation.id, { status: "closed" });
    return { conversationId: conversation.id, reply: null, status: "closed" };
  }

  // הודעה קולית שלא הצלחנו לתמלל - מבקשים מהלקוח להקליד, בלי לערב את המודל.
  // מגיע לכאן רק אם הבוט פעיל ואין נציג אנושי (כללי השתיקה למעלה כבר חלים).
  if (input.meta?.voiceTranscriptionFailed) {
    // שפה אחת בלבד: לפי ההודעות הקודמות בשיחה, וברירת מחדל עברית (רוב מוחלט של הקהל).
    const prior = await repo.getMessages(conversation.id);
    const vLang = detectLang(
      prior.filter((m) => m.role === "user" && m.content).slice(-3).map((m) => m.content)
    );
    const reply =
      vLang === "en"
        ? "I got your voice message but couldn't make it out 🙏 Could you type it in a few words?"
        : "קיבלתי הודעה קולית אבל לא הצלחתי להבין אותה 🙏 אפשר לכתוב לי בכמה מילים?";
    await repo.addMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: reply,
      ts: Date.now(),
    });
    return { conversationId: conversation.id, reply, status: "bot" };
  }

  // ----- הגבלת קצב (rate limit): הגנה מפני הצפת הודעות -----
  {
    const recent = await repo.getMessages(conversation.id);
    const now = Date.now();
    const perMin = recent.filter((m) => m.role === "user" && m.ts > now - 60_000).length;
    const perHour = recent.filter((m) => m.role === "user" && m.ts > now - 3_600_000).length;
    if (perMin > RATE_PER_MIN || perHour > RATE_PER_HOUR) {
      console.log(`[RATE_LIMIT] conv=${conversation.id} perMin=${perMin} perHour=${perHour}`);
      // במקום שתיקה מוחלטת - שולחים הודעה ידידותית אחת לכל "התקף" (לא בכל הודעה),
      // כדי שהלקוח יבין למה הבוט שקט ולא יחשוב שמשהו תקול.
      const last = rateNoticeAt.get(conversation.id) ?? 0;
      if (now - last > RATE_NOTICE_COOLDOWN_MS) {
        rateNoticeAt.set(conversation.id, now);
        if (rateNoticeAt.size > 1000) rateNoticeAt.delete(rateNoticeAt.keys().next().value as string);
        const phone = (await loadBusinessConfig()).contact.phone;
        const rlLang = detectLang(
          recent.filter((m) => m.role === "user").slice(-3).map((m) => m.content)
        );
        const notice =
          rlLang === "en"
            ? `I got a few messages in a row 🙂 I'm answering them one by one, so give me a moment and I'll get back to you.${phone ? ` If it's urgent, you can call our team at ${phone}.` : ""}`
            : `קיבלתי כמה הודעות ברצף 🙂 אני עונה אחת-אחת, אז שנייה של סבלנות ואני אחזור אליך.${phone ? ` אם זה דחוף אפשר להתקשר לצוות ב-${phone}.` : ""}`;
        await repo.addMessage({
          conversationId: conversation.id,
          role: "assistant",
          content: notice,
          ts: Date.now(),
          meta: { rateLimitNotice: true },
        });
        return { conversationId: conversation.id, reply: notice, status: conversation.status };
      }
      return { conversationId: conversation.id, reply: null, status: conversation.status };
    }
  }

  // ----- טיפול ברצף הודעות: דבאונס + "ההודעה האחרונה מנצחת" -----
  // מחכים רגע קצר; אם בינתיים הגיעה הודעה חדשה יותר, הקריאה הזו פורשת
  // (הקריאה החדשה תטפל בכל ההודעות יחד, ותחזיר תשובה אחת קוהרנטית).
  await sleep(DEBOUNCE_MS);

  // קריאה אחת מקבילה לכל מה שצריך אחרי הדבאונס (פחות הלוך-ושוב ל-DB = מענה מהיר יותר)
  const [stored, answeredQA, cfgEarly] = await Promise.all([
    repo.getMessages(conversation.id),
    repo.listLearnedQA("answered"),
    loadBusinessConfig(),
  ]);

  // מאגר התשובות החינמיות: ידע נלמד + השאלות הנפוצות מהקונפיג (שתיהן נכתבו ע"י הצוות)
  const freeQAs = [
    ...answeredQA,
    ...(cfgEarly.faqs ?? []).map((f, i) => ({ id: `faq:${i}`, question: f.question, answer: f.answer })),
  ];

  // אם בינתיים הגיעה הודעה חדשה יותר, פורשים (הקריאה החדשה תטפל בהכל יחד).
  // שובר-שוויון לפי מזהה: שתי הודעות באותה מילישנייה - רק אחת מהקריאות ממשיכה.
  if (
    stored.some(
      (m) =>
        m.role === "user" &&
        (m.ts > myTs || (m.id !== myMsg.id && m.ts === myTs && m.id > myMsg.id))
    )
  ) {
    return { conversationId: conversation.id, reply: null, status: conversation.status };
  }

  const isFirstTurn = !conversation.disclosedAi;

  // בניית היסטוריה (ממוזגת - רצף הודעות לקוח נחשב כתור אחד).
  // תשובת נציג אנושי (agent) נחשבת כצד ה-assistant של השיחה, כדי שהבוט יראה
  // ששאלה שהנציג כבר ענה עליה טופלה - ולא יחזור עליה ולא ימזג שאלות שכבר נענו.
  // אבל היא מתויגת (AGENT_MSG_PREFIX) כדי שהמודל ידע להבדיל בין דבריו לדברי
  // הצוות ולא יסתור אותם (כלל 20 בפרומפט).
  // חלון היסטוריה: בשיחה שעברה טיפול אנושי מרחיבים את החלון, כדי שההקשר
  // המקורי (מה הלקוח ביקש לפני שהנציג נכנס) לא יידחק החוצה על ידי חילופי
  // הדברים עם הנציג - כשהשיחה חוזרת לבוט הוא ממשיך עם התמונה המלאה.
  // שיחות רגילות נשארות בחלון הקטן (עלות).
  const windowSize = stored
    .slice(-HISTORY_LIMIT_AFTER_AGENT)
    .some((m) => m.role === "agent")
    ? HISTORY_LIMIT_AFTER_AGENT
    : HISTORY_LIMIT;
  const history = mergeConsecutive(
    stored
      .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "agent")
      .slice(-windowSize)
      .map((m) => ({
        role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
        content: m.role === "agent" ? AGENT_MSG_PREFIX + m.content : m.content,
      }))
  );

  // ידע נלמד: שאלות שהצוות ענה עליהן מוזרקות לבוט
  const learnedFaqs = answeredQA
    .filter((q) => q.answer)
    .map((q) => ({ question: q.question, answer: q.answer as string }));

  // שליפת שם המשתמש מהערוץ (רק אם אין עדיין שם שמור) - רץ במקביל לקריאת המודל
  // כדי לא להוסיף זמן תגובה, ונשמר ללקוח כדי שיופיע בפאנל.
  const namePromise =
    !customer.name && input.resolveName
      ? input
          .resolveName()
          .then((name) =>
            name
              ? repo.upsertCustomer({
                  id: customerId,
                  channel: input.channel,
                  channelUserId: input.channelUserId,
                  name,
                })
              : undefined
          )
          .catch(() => undefined)
      : Promise.resolve(undefined);

  // ----- תשובות מהירות (בלי מודל = חינם): תבניות + ידע נלמד + מחירי תפריט -----
  // עובד גם בהודעה הראשונה בשיחה: שוזרים את גילוי ה-AI (דרישת Meta) לפני התבנית.
  const lastUserTurn = [...history].reverse().find((m) => m.role === "user")?.content ?? "";
  const quickKeys = matchQuickAnswers(lastUserTurn);
  const kbHit = quickKeys.length ? null : matchLearnedAnswer(lastUserTurn, freeQAs);

  // ----- פתיחת שער החניה (זיהוי דטרמיניסטי, בלי מודל) -----
  // בקשה מפורשת לפתוח את השער מטופלת ישירות בקוד - לא נשאלת מהמודל, כי הוא לפעמים
  // מסרב לבד כשהוא "חושב" שסגור. הקוד אוכף שעות בעצמו (עם מתג העקיפה הזמני).
  if (isGateConfigured() && isGateOpenRequest(lastUserTurn)) {
    const gLang = langFromHistory(history);
    const gate = await runGateOpen({
      repo,
      conversationId: conversation.id,
      cfg: cfgEarly,
      customerId,
      customerName: customer.name,
      channel: input.channel,
      gLang,
      priorMessages: stored,
      modelReply: "",
    });
    let gateReply = gate.reply;
    if (isFirstTurn) {
      const hello =
        gLang === "en"
          ? `Hi! I'm the digital assistant of ${cfgEarly.name} 🙂 (you can always ask for a human agent).`
          : `היי! אני העוזר הדיגיטלי של ${cfgEarly.name} 🙂 (ואפשר תמיד לבקש נציג אנושי).`;
      gateReply = `${hello}\n\n${gateReply}`;
      await repo.updateConversation(conversation.id, { disclosedAi: true });
    }
    await namePromise.catch(() => undefined);
    await repo.addMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: gateReply,
      ts: Date.now(),
      meta: gate.status === "human" ? { escalation: true } : { gateReply: true },
    });
    await recordFreeReply();
    return { conversationId: conversation.id, reply: gateReply, status: gate.status };
  }

  {
    const cfg = cfgEarly;
    const cannedLang = langFromHistory(history);
    // אינסטגרם לא מאפשר שליחת מדיה דרך ה-API - במקום סרטון מצורף שולחים קישור בתוך הטקסט
    const isIG = input.channel === "instagram";
    let cannedKey = quickKeys.join("+");
    let built: string | null = null;
    let parkingVideo: MediaItem | undefined;
    let igVideoLinked: string | undefined; // מזהה סרטון שנשלח כקישור (לרישום sentMedia)
    if (quickKeys.length) {
      // סרטון הדרך לחניה מצורף לתשובות מיקום/חניה (מאותר בספרייה לפי מילות מפתח)
      const needVideo = quickKeys.includes("location") || quickKeys.includes("parking");
      parkingVideo = needVideo
        ? (await loadMedia()).find((m) => m.type === "video" && m.url && /חני/.test(`${m.label} ${m.keywords}`))
        : undefined;
      // שני מפתחות = לחיצה על שני כפתורים ברצף - עונים על שניהם בהודעה אחת (בחינם)
      const parts = quickKeys.map((k) => buildQuickAnswer(k, cfg, cannedLang, !isIG && !!parkingVideo));
      built = parts.every((p): p is string => !!p) ? parts.join("\n\n") : null;
      if (built && isIG && parkingVideo) {
        built += `\n🎥 סרטון קצר שמראה את הדרך לחניה: ${PARKING_PAGE_URL}`;
        igVideoLinked = parkingVideo.id;
        parkingVideo = undefined;
      }
    } else if (kbHit) {
      built = kbHit.answer;
      cannedKey = `kb:${kbHit.id}`;
      // רישום השאילה בפאנל הידע (מונה + מי שאל) - רק לפריטי ידע נלמד, לא ל-faq מהקונפיג
      if (!kbHit.id.startsWith("faq:")) {
        await repo
          .recordLearnedQAAsk(kbHit.id, { conversationId: conversation.id, name: customer.name, ts: Date.now() })
          .catch(() => undefined);
      }
    } else if (cannedLang === "he" && PRICE_HINT.test(lastUserTurn)) {
      built = menuPriceAnswer(lastUserTurn, cfg);
      if (built) cannedKey = "price";
    }
    if (!built && cannedLang === "he") {
      built = menuCategoryAnswer(lastUserTurn, cfg);
      if (built) cannedKey = "category";
    }
    // מנוע זמינות ההזמנות (24.8): בקשה ליום/שעה שאין בהם הזמנות נענית מתבנית
    // מחושבת במקום מהמודל - זול יותר, ובעיקר לא טועה בכללי ההזמנות.
    if (!built && cannedLang === "he") {
      const avail = checkReservationAvailability(lastUserTurn, cfg);
      if (avail) {
        built = avail.text;
        cannedKey = `avail:${avail.reason}`;
      }
    }
    if (!built && cannedLang === "he" && ACK_RX.test(lastUserTurn.trim())) {
      // מעקה: אם ההודעה האחרונה של הבוט הייתה שאלה, או שיש זרימת הזמנה פתוחה
      // (הבוט הציע לשריין/טאביט) - "תודה" היא חלק מהזרימה -> מודל, שיוודא שההזמנה
      // לא ננטשה באמצע (תקרית משה שירו 17.8: "תודה" באמצע הזמנה קיבל "נתראה!").
      const lastAssistant = [...stored].reverse().find((m) => m.role === "assistant");
      const la = lastAssistant?.content ?? "";
      // הזמנה שכבר הועברה לצוות: "תודה" הוא סיום אמיתי, אבל אסור שהסגירה תישמע
      // כאילו יש אישור ("נתראה ביום שלישי" - קרה בבדיקה 24.8). תשובה קבועה
      // ובטוחה, גם חוסכת תור מודל בסוף כל הזמנה.
      const handedOff = /מעביר את הבקשה לצוות|יבדקו שיש מקום|passed your request/i.test(la);
      if (handedOff) {
        built = "בשמחה! 🙂 נעדכן אותך כאן ברגע שהצוות יבדוק שיש מקום.";
        cannedKey = "ack-reservation";
      // "שאלה פתוחה" = ההודעה *מסתיימת* בסימן שאלה. לא מספיק שיש "?" איפשהו:
      // תבנית המיקום נגמרת לפעמים ב-CTA רטורי ("צריכים עוד משהו? תפריט, שעות...")
      // וזה שלח כל "תודה" שאחריה למודל בחינם-שלא-לצורך (נמצא 24.8).
      } else if (!/\?[\s🙂😊👍🙏]*$/.test(la.trim()) && !/לשריין|אשריין|טאביט|tabit|להזמין מראש|בצ'אט/i.test(la)) {
        built = ACK_REPLIES[Math.floor(Math.random() * ACK_REPLIES.length)];
        cannedKey = "ack";
      }
    }
    if (built) {
      // קירור חכם: "עניתי ממש כאן למעלה" רק על לחיצה כפולה אמיתית - אותו טקסט בדיוק
      // (אחרי נרמול) כמו ההודעה שהובילה לאותה תשובה, בתוך 3 דקות. ניסוח מחדש,
      // שאלה שונה או תלונה ("הסרטון לא נפתח") תמיד מקבלים תשובה מלאה.
      const complaintRx = /לא (עובד|נפתח|הגיע|קיבלתי|רואה|כתוב|מופיע|הבנתי)|שוב|עוד פעם|תקלה|בעיה/;
      let repeat = false;
      if (!complaintRx.test(lastUserTurn)) {
        const collapsed = normalizeQ(
          [...new Set(lastUserTurn.split("\n").map((s) => s.trim()).filter(Boolean))].join(" ")
        );
        for (let i = stored.length - 1; i >= 0; i--) {
          const m = stored[i];
          if (m.role === "assistant" && m.meta?.canned === cannedKey && Date.now() - m.ts < 3 * 60_000) {
            // ההודעה של הלקוח שהובילה לתשובה ההיא חייבת להיות זהה להודעה הנוכחית
            for (let j = i - 1; j >= 0; j--) {
              if (stored[j].role === "user") {
                repeat = normalizeQ(stored[j].content) === collapsed;
                break;
              }
            }
            break;
          }
        }
      }
      let canned = repeat
        ? cannedLang === "en"
          ? "Just answered right above 🙂👆"
          : "עניתי ממש כאן למעלה 🙂👆"
        : built;
      const attach = repeat ? undefined : parkingVideo;
      if (isFirstTurn) {
        const hello =
          cannedLang === "en"
            ? `Hi! I'm the digital assistant of ${cfg.name} 🙂 (you can always ask for a human agent).`
            : `היי! אני העוזר הדיגיטלי של ${cfg.name} 🙂 (ואפשר תמיד לבקש נציג אנושי).`;
        canned = `${hello}\n\n${canned}`;
        await repo.updateConversation(conversation.id, { disclosedAi: true });
      }
      await namePromise.catch(() => undefined);
      await repo.addMessage({
        conversationId: conversation.id,
        role: "assistant",
        content: canned,
        ts: Date.now(),
        meta: {
          canned: repeat ? `${cannedKey}-repeat` : cannedKey,
          ...(attach ? { sentMedia: [attach.id] } : igVideoLinked && !repeat ? { sentMedia: [igVideoLinked] } : {}),
        },
      });
      await recordFreeReply();
      console.log(`[CANNED] תבנית "${cannedKey}"${repeat ? " (חזרה)" : ""} - 0 עלות, conv=${conversation.id}`);
      // דרושים = הסלמה אמיתית (הוחלט 20.8): התבנית מבטיחה שהפנייה עוברת לצוות,
      // אז השיחה באמת עוברת לטיפול אנושי - הפרטים שהמועמד ישאיר ינחתו אצל הנציג.
      if (!repeat && quickKeys.includes("jobs")) {
        const jobsSummary = `פניית דרושים: ${lastUserTurn.slice(0, 200)}`;
        await repo.updateConversation(conversation.id, {
          status: "human",
          escalated: true,
          escalationReason: "פניית דרושים - מועמד/ת לעבודה",
          escalationSummary: jobsSummary,
        });
        await repo.addMessage({
          conversationId: conversation.id,
          role: "system",
          content: `הוסלם לנציג: פניית דרושים - מועמד/ת לעבודה\nסיכום: ${jobsSummary}`,
          ts: Date.now(),
          meta: { escalation: true, summary: jobsSummary },
        });
        sendEscalationEmail({
          customerName: customer.name,
          channel: input.channel,
          reason: "פניית דרושים - מועמד/ת לעבודה",
          summary: jobsSummary,
          conversationId: conversation.id,
        }).catch(() => {});
        return { conversationId: conversation.id, reply: canned, status: "human" };
      }
      return {
        conversationId: conversation.id,
        reply: canned,
        status: "bot",
        media: attach ? [{ url: attach.url, type: "video" as const }] : undefined,
      };
    }
  }

  // הזמנות פעילות של הלקוח (ממתינות/מאושרות שעוד לא עברו) - מוזרקות למוח כדי
  // שהבוט יזכור התחייבויות: "יש לך הזמנה בעוד שבוע" גם בשיחה חדשה לגמרי
  let activeReservations: string | undefined;
  try {
    const today = israelDateISO();
    const mine = (await loadReservations()).filter(
      (r) => r.customerId === customerId && r.status !== "declined" && (!r.dateISO || r.dateISO >= today)
    );
    if (mine.length) {
      activeReservations = mine
        .map(
          (r) =>
            `${r.status === "approved" ? "נמצא מקום (סופי אחרי תשלום הפיקדון בקישור ששלח הצוות)" : "ממתינה לאישור הצוות"}: ${r.people} אנשים, ${r.dateText} בשעה ${r.time}, ע"ש ${r.name}${r.notes ? ` (${r.notes})` : ""}`
        )
        .join("; ");
    }
  } catch {
    /* לא קריטי - ממשיכים בלי */
  }

  // רמז פרטי הזמנה (24.8): כשהשיחה היא זרימת הזמנה, הקוד מחלץ את מה שכבר נמסר
  // ומעביר למודל - כדי שלא ישאל פעמיים ולא יתבלבל בפרטים. רמז בלבד: השיחה קובעת.
  let reservationSlots: string | undefined;
  if (looksLikeReservationFlow(history)) {
    reservationSlots = reservationSlotsHint(extractReservationSlots(history)) ?? undefined;
  }

  let result;
  try {
    result = await generateReply(history, {
      firstTurn: isFirstTurn,
      learnedFaqs,
      customerMemory: customer.memory,
      channel: input.channel,
      activeReservations,
      reservationSlots,
    });
  } catch (err) {
    // תקלה רגעית במוח (API נפל/timeout) - הלקוח לעולם לא נשאר בלי מענה.
    console.error("[conversation-service] generateReply נכשל:", err);
    await namePromise.catch(() => undefined);

    // 🚨 אזעקת מערכת לפאנל: נרשמת בכל כשל מודל, עם זיהוי מיוחד לקרדיטים שאזלו.
    // הפאנל מציג באנר אדום לכל הצוות (ההפקה מהתקרית של 3.8: יום שלם בלי שאף אחד ידע).
    const errMsg = err instanceof Error ? err.message : String(err);
    const alarmReason = /credit balance/i.test(errMsg) ? "credit" : "api";
    alarmRaised = true;
    await repo
      .setSetting("api_alarm", JSON.stringify({ ts: Date.now(), reason: alarmReason, sample: errMsg.slice(0, 180) }))
      .catch(() => undefined);
    // התראת וואטסאפ לצוות (מווסתת לאחת בשעה) - שידעו על התקלה גם בלי פאנל פתוח
    sendSystemAlarmWhatsApp(alarmReason).catch(() => undefined);

    // אם בינתיים הגיעה הודעה חדשה יותר, נטוש (הקריאה החדשה תטפל)
    if (await hasNewerUserMessage(conversation.id, myTs, myMsg.id)) {
      return { conversationId: conversation.id, reply: null, status: conversation.status };
    }
    const cfg = await loadBusinessConfig();
    const phone = cfg.contact.phone;
    const fallback =
      langFromHistory(history) === "en"
        ? `Sorry, I'm having a technical issue right now 🙏 I've passed your message to our team and they'll get back to you here.${phone ? ` If it's urgent, you can call us at ${phone}.` : ""}`
        : `סליחה, יש לי תקלה טכנית כרגע 🙏 העברתי את הפנייה לצוות שלנו והם יחזרו אליך כאן.${phone ? ` אם זה דחוף, אפשר להתקשר ל-${phone}.` : ""}`;
    await repo.addMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: fallback,
      ts: Date.now(),
      meta: { fallback: true },
    });
    // מסמנים את השיחה כהסלמה - שהצוות יראה אותה מיד בפאנל ויטפל בלקוח בעצמו
    // (בתקרית של 3.8 השיחות נראו "נענו" ואף אחד לא שם לב)
    await repo
      .updateConversation(conversation.id, {
        escalated: true,
        escalationReason: "תקלת מערכת - הבוט לא הצליח לענות",
      })
      .catch(() => undefined);
    return { conversationId: conversation.id, reply: fallback, status: "bot" };
  }
  await namePromise;

  // המודל חזר לעבוד אחרי כשל - מכבים את אזעקת המערכת בפאנל
  if (alarmRaised) {
    alarmRaised = false;
    await repo.setSetting("api_alarm", "").catch(() => undefined);
  }

  // רישום שימוש ועלות אמיתית (מזין גם את התקרה היומית וגם את מד העלות בפאנל)
  await recordLlmUsage(result.model ?? "", result.usage ?? {});

  // בדיקה סופית: אם בזמן שהמודל ניסח, הגיעה הודעה חדשה - זורקים את התשובה
  // (הקריאה החדשה תייצר תשובה מעודכנת). מונע תשובה כפולה/לא מעודכנת.
  if (await hasNewerUserMessage(conversation.id, myTs, myMsg.id)) {
    return { conversationId: conversation.id, reply: null, status: conversation.status };
  }

  // ----- המודל החליט להעביר לנציג אנושי -----
  if (result.escalate) {
    await repo.updateConversation(conversation.id, {
      status: "human",
      escalated: true,
      escalationReason: result.escalate.reason,
      escalationSummary: result.escalate.summary,
      meta: result.escalate.urgent ? { urgent: true } : undefined,
    });
    // התראת אימייל לצוות (אם מוגדר RESEND_API_KEY) - לא חוסם
    sendEscalationEmail({
      customerName: customer.name,
      channel: input.channel,
      reason: result.escalate.reason,
      summary: result.escalate.summary,
      urgent: result.escalate.urgent,
      conversationId: conversation.id,
    }).catch(() => {});
    await repo.addMessage({
      conversationId: conversation.id,
      role: "system",
      content: `הוסלם לנציג: ${result.escalate.reason}\nסיכום: ${result.escalate.summary}`,
      ts: Date.now(),
      meta: { escalation: true, summary: result.escalate.summary },
    });

    const handoff = buildHandoffMessage(
      isFirstTurn,
      await loadBusinessConfig(),
      langFromHistory(history)
    );
    if (isFirstTurn) {
      await repo.updateConversation(conversation.id, { disclosedAi: true });
    }
    await repo.addMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: handoff,
      ts: Date.now(),
      meta: { escalation: true },
    });
    // התראה לצוות (כרגע ללוג; בהמשך אימייל/וואטסאפ/דחיפה)
    console.log(
      `[ESCALATION] conv=${conversation.id} customer=${customerId} reason=${result.escalate.reason}`
    );
    return { conversationId: conversation.id, reply: handoff, status: "human" };
  }

  // ----- תשובה רגילה -----
  // בהודעה ראשונה עם שאלה, המודל כבר שזר את גילוי ה-AI בתוך התשובה (ראה claude.ts),
  // אז לא מדביקים משפט קבוע. (פתיחה של "רק ברכה" טופלה למעלה במסלול נפרד.)
  let reply = (result.text ?? "").trim();
  // מעקה: במקרים נדירים המודל מדליף סימון קריאת-כלי כטקסט גלוי - חותכים לפני שהלקוח רואה
  for (const marker of ["<tool_call", "&lt;tool_call", "</tool_call", "<function_call", "<invoke"]) {
    const idx = reply.indexOf(marker);
    if (idx >= 0) reply = reply.slice(0, idx).trim();
  }
  // הדגשה בכוכבית כפולה (**מילה**) מוצגת כתווים גולמיים בוואטסאפ/מסנג'ר - ממירים
  // לכוכבית בודדת (מודגש תקין). תיקון דטרמיניסטי במקום לרדוף אחרי המודל בפרומפט.
  reply = reply.replace(/\*\*([^*\n]+)\*\*/g, "*$1*");
  if (!reply) {
    reply =
      langFromHistory(history) === "en"
        ? "Sorry, I didn't quite catch that. Could you try again? 🙂"
        : "סליחה, לא הבנתי. אפשר לנסות שוב? 🙂";
  }
  if (isFirstTurn) {
    await repo.updateConversation(conversation.id, { disclosedAi: true });
  }

  // ----- פתיחת שער החניה (נתיב המודל - גיבוי לזיהוי הדטרמיניסטי שלמעלה) -----
  if (result.openGateRequested && isGateConfigured()) {
    const gate = await runGateOpen({
      repo,
      conversationId: conversation.id,
      cfg: cfgEarly,
      customerId,
      customerName: customer.name,
      channel: input.channel,
      gLang: langFromHistory(history),
      priorMessages: stored,
      modelReply: reply,
    });
    reply = gate.reply;
    if (gate.status === "human") {
      await repo.addMessage({
        conversationId: conversation.id,
        role: "assistant",
        content: reply,
        ts: Date.now(),
        meta: { escalation: true },
      });
      return { conversationId: conversation.id, reply, status: "human" };
    }
  }

  // ----- בקשת הזמנת מקום: יצירת כרטיס בפאנל + תיעוד ביומן השיחה -----
  if (result.reservation) {
    const r = result.reservation;
    let createdIsNew = false;
    try {
      // תאריך דטרמיניסטי: הקוד גוזר בעצמו את התאריך מ"מחר"/"יום חמישי"/"13.8"
      // ולא סומך על חישוב המודל (שטעה בפועל ונדד בין תאריכים באותה שיחה).
      const resolvedISO = resolveReservationDate(r.date_text, r.date);
      const created = await createReservation({
        conversationId: conversation.id,
        customerId,
        channel: input.channel,
        customerName: customer.name,
        people: Number(r.people) || 0,
        dateText: r.date_text,
        dateISO: resolvedISO,
        time: r.time,
        name: r.name,
        phone: r.phone,
        notes: r.notes,
      });
      // רושמים ביומן השיחה רק כשבאמת נוצר כרטיס חדש - קריאה כפולה של המודל
      // (למשל אחרי "תודה") מוחזרת כ-dup ולא מייצרת רישום שני מטעה בפאנל.
      const isNew = Date.now() - created.createdAt < 10_000;
      createdIsNew = isNew;
      if (isNew) {
        const dLabel = reservationDateLabel(resolvedISO);
        await repo.addMessage({
          conversationId: conversation.id,
          role: "system",
          content: `🍽️ נפתחה בקשת הזמנה: ${r.people} אנשים, ${r.date_text}${dLabel && !r.date_text.includes(dLabel) ? ` (${dLabel})` : ""} ב-${r.time}, ע"ש ${r.name} (${r.phone})`,
          ts: Date.now(),
          meta: { activity: true, reservation: true },
        });
      }
    } catch (err) {
      console.error("[reservation] יצירת בקשה נכשלה:", err);
    }
    // רשת ביטחון (תוקן 11.8 - קודם עדכן את result.text אחרי ש-reply כבר חולץ,
    // ולכן לא עבד בפועל): אחרי קריאת הכלי הלקוח חייב לדעת שהבקשה עברה לצוות
    // ושאישור מגיע רק אחרי בדיקת זמינות - לעולם לא ניסוח שנשמע כאילו סגור.
    const handoffLine =
      langFromHistory(history) === "en"
        ? "I've passed your request to our team - they'll check availability and update you right here soon. If there's room, you'll get a Tabit link to complete a 100 ILS deposit, and the reservation is final once it's paid 🙂"
        : "קיבלתי את כל הפרטים 🙂 אני מעביר את הבקשה לצוות - הם יבדקו שיש מקום פנוי ויעדכנו כאן בצ'אט בהקדם. אם יש מקום, תקבלו קישור לתשלום פיקדון של 100 ש\"ח, וההזמנה סופית אחרי התשלום.";
    // ⚠️ רק על כרטיס חדש (תוקן 24.8): כשהמודל קורא לכלי פעם שנייה על אותה בקשה
    // (קרה בפועל אחרי "תודה רבה!" בסוף הזרימה), createReservation מחזיר את
    // הכרטיס הקיים - ואז הדבקת משפט ההעברה שוב שלחה ללקוח את כל הסיכום מחדש.
    if (createdIsNew) {
      if (reply.trim().length < 15) {
        reply = handoffLine;
      } else if (!/צוות|team/i.test(reply)) {
        reply = `${reply}\n\n${handoffLine}`;
      }
    }
  }

  // תיעוד פערי ידע: עדיפות לשאלות שהמודל סימן במפורש (report_knowledge_gap),
  // ובגיבוי - זיהוי דטרמיניסטי לפי ניסוח התשובה. כך נתפסת כל שאלה שלא נענתה.
  if (result.gapQuestions?.length) {
    for (const q of result.gapQuestions) {
      await logOpenQuestion(q, conversation.id, customer.name);
    }
  } else if (detectKnowledgeGap(reply) && input.text.length <= 140) {
    // גיבוי היוריסטי - רק להודעה קצרה וממוקדת. בהודעה ארוכה/מרובת-שאלות אסור
    // לזרוק את כל הטקסט ל"ידע"; שם מסתמכים על חילוץ השאלות ע"י המודל (report_knowledge_gap).
    await logOpenQuestion(input.text, conversation.id, customer.name);
  }

  // פתרון מזהי המדיה שהבוט בחר לשלוח -> כתובות בפועל.
  // בלם רלוונטיות: שולחים פריט רק אם הוא נוגע לנושא של ההקשר הקרוב בשיחה (לא רק
  // ההודעה האחרונה - כדי שזרם "רוצה סרטון? -> כן" יעבוד), ולא שולחים פעמיים את אותו
  // פריט באותה שיחה (מניעת כפילות, למשל כששואלים שאלת המשך).
  let media: { url: string; type: "image" | "video" }[] | undefined;
  let sentMediaIds: string[] | undefined;
  if (result.mediaIds?.length) {
    // הקשר רלוונטיות: כמה הודעות אחרונות (שני הצדדים) + התשובה הנוכחית.
    const contextText =
      history.slice(-5).map((m) => m.content).join(" ") + " " + reply;
    // מדיה שכבר נשלחה "בפרק הנוכחי" של השיחה: מאז הפתיחה-מחדש האחרונה, ולכל
    // היותר 14 יום אחורה. השיחה היא כעת חלון מתמשך אחד לכל לקוח, ולקוח שחוזר
    // אחרי חודש ושואל שוב על החניה צריך לקבל את הסרטון שוב - לא חסימת "כבר נשלח".
    const lastReopenTs = stored.reduce(
      (acc, m) => (m.role === "system" && m.meta?.reopened && m.ts > acc ? m.ts : acc),
      0
    );
    const mediaDedupSince = Math.max(lastReopenTs, Date.now() - 14 * 86_400_000);
    const alreadySent = new Set<string>(
      stored
        .filter((m) => m.ts >= mediaDedupSince)
        .flatMap((m) => (m.meta?.sentMedia as string[] | undefined) ?? [])
    );
    const chosen = (await loadMedia()).filter((m) => result.mediaIds!.includes(m.id));
    // הלקוח מתלונן שהמדיה לא הגיעה ("הסרטון לא נפתח", "תשלח שוב") - עוקפים את חסימת
    // הכפילות ושולחים שוב. בלי זה הבוט ענה "שלחתי" בלי לשלוח כלום (ממצא מהסריקה השבועית).
    const resendAsked =
      /סרטון|וידאו|תמונה|תמונות/.test(lastUserTurn) &&
      /לא (עובד|נפתח|הגיע|קיבלתי|רואה|נשלח|רץ)|שוב|עוד פעם/.test(lastUserTurn);
    const toSend = chosen.filter(
      (m) => isMediaRelevant(m, contextText) && (!alreadySent.has(m.id) || resendAsked)
    );
    const dropped = chosen.filter((m) => !toSend.includes(m));
    if (dropped.length) {
      console.log(
        `[MEDIA] חסמתי מדיה: ${dropped.map((m) => m.label).join(", ")} (לא רלוונטי/כבר נשלח)`
      );
    }
    if (toSend.length) {
      if (input.channel === "instagram") {
        // אינסטגרם לא מאפשר שליחת מדיה דרך ה-API - משרשרים קישורים לתשובה במקום קובץ.
        // לסרטון החניה יש עמוד ממותג באתר - עדיף על קישור אחסון גולמי.
        reply +=
          "\n\n" +
          toSend
            .map((m) => {
              const url = m.type === "video" && /חני/.test(`${m.label} ${m.keywords}`) ? PARKING_PAGE_URL : m.url;
              return `${m.type === "video" ? "🎥" : "📷"} ${m.label}: ${url}`;
            })
            .join("\n");
        sentMediaIds = toSend.map((m) => m.id);
      } else {
        media = toSend.map((m) => ({ url: m.url, type: m.type as "image" | "video" }));
        sentMediaIds = toSend.map((m) => m.id);
      }
    }
  }

  // ----- רשת ביטחון: הבטחת מדיה שלא מומשה (תוקן 22.8) -----
  // ממצא מביקורת העלות והאיכות: ב-16 תשובות הבוט כתב "מצרף לך סרטון קצר של הדרך"
  // ובפועל לא נשלח כלום (הוא לא קרא לכלי, או שהמדיה נחסמה ככפילות/לא רלוונטית).
  // לקוחות התלוננו במפורש ("לא רואה איפה התשובה", "אין סיכוי שנגיע אם לא ברור מקום חנייה")
  // ואחד מהם נטש. כאן, אם התשובה מבטיחה מדיה ואין מדיה - מחליפים את ההבטחה בקישור אמיתי.
  if (!media?.length && !sentMediaIds?.length) {
    const promisesMedia = /(מצרף|שולח|אשלח|שלחתי|מעביר)\s+(לך|לכם|לך גם|כאן)?\s*(את ה)?(סרטון|וידאו|תמונה|קליפ)/.test(reply);
    if (promisesMedia) {
      const aboutParking = /חני|שער|דרך|להגיע|מגיעים/.test(reply + " " + lastUserTurn);
      reply = aboutParking
        ? `${reply}\n\n🎥 הנה הסרטון שמראה בדיוק איך מגיעים לחניה: ${PARKING_PAGE_URL}`
        : reply.replace(
            /(מצרף|שולח|אשלח|שלחתי|מעביר)\s+(לך|לכם|לך גם|כאן)?\s*(את ה)?(סרטון|וידאו|תמונה|קליפ)[^.!?\n]*/g,
            "אשמח לפרט כאן בכתב"
          );
      console.log(`[MEDIA] הבטחת מדיה בלי מדיה - תוקן בתשובה, conv=${conversation.id}`);
    }
  }

  // רשת ביטחון נגד מרוץ (ממצא משיחת 12.8): אם בזמן שהמודל חשב נציג אנושי
  // השתלט על השיחה או השהה את הבוט - הבוט שותק ולא "מדבר מעל" הנציג.
  // בדיקת השתיקה בתחילת הזרימה קראה את מצב השיחה לפני קריאת המודל (שאורכת
  // שניות), והחלון הזה הספיק לבוט לענות אחרי הודעת נציג.
  const freshConv = await repo.getConversation(conversation.id);
  if (freshConv && (freshConv.status === "human" || freshConv.botPaused)) {
    console.log(`[SILENCE] נציג נכנס תוך כדי חשיבת המודל - הבוט שותק. conv=${conversation.id}`);
    return { conversationId: conversation.id, reply: null, status: freshConv.status };
  }

  await repo.addMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: reply,
    ts: Date.now(),
    meta: sentMediaIds ? { sentMedia: sentMediaIds } : undefined,
  });

  return { conversationId: conversation.id, reply, status: "bot", media };
}
