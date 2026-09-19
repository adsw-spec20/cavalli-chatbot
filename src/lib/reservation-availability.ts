/**
 * מנוע זמינות הזמנות - תשובה דטרמיניסטית לבקשות שאי אפשר לקבל.
 *
 * למה בקוד ולא במודל: 10% מהתשובות ששולמו (22 ב-3 ימים) היו בקשות ליום ושעה
 * שבהם אין הזמנות בכלל ("יש מקום להיום?", "מקום למחר בבוקר", "להזמין לשישי").
 * התשובה בכל המקרים האלה זהה, וניתנת לחישוב מהיום והשעה - בדיוק כמו "פתוחים
 * עכשיו?". חשוב מזה: זה בדיוק המקום שהמודל הכי טעה בו בעבר (לקח הזמנות לשישי,
 * לראשון בערב ולשעות היום), וקוד לא טועה בזה.
 *
 * **ההכרעה עצמה לא נמצאת כאן** אלא ב-reservation-policy.ts (מקור אמת אחד
 * שממנו נבנה גם הפרומפט). כאן רק הפענוח: האם זו בקשת הזמנה, לאיזה יום, לאיזו
 * שעה וכמה סועדים - ושעות הפעילות של אותו תאריך מהקונפיג.
 *
 * שני שימושים:
 *   1. checkReservationAvailability - הודעה בודדת עם כוונת הזמנה מפורשת ->
 *      תשובה קבועה במקום המודל. שמרני בכוונה: כל ספק מחזיר null.
 *   2. policyVerdictFor - שורת הכרעה שמוזרקת למודל לפי הפרטים שנאספו בכל
 *      השיחה (19.9). בלעדיה, הודעת המשך כמו "אז ליום ראשון הבא ב-20:00" (בלי
 *      מילת הזמנה) הגיעה למודל בלי הכרעה, והוא אמר ללקוח לבוא לראשון ב-20:00
 *      כשנסגרים ב-18:00.
 */

import type { BusinessConfig } from "./business-config";
import { resolveReservationDate } from "./date-resolve";
import { hoursForDate, lastSeatingForDate, parseHoursRange } from "./business-hours";
import { addDaysISO, formatDayHe } from "./day-context";
import {
  decideReservation,
  BOOKING_DAYS,
  BOOKING_FROM_HOUR,
  GROUP_MIN_FOR_BARAK,
  RESERVATION_TEXTS,
  type OpenWindow,
  type PolicyDecision,
} from "./reservation-policy";

/** כוונת הזמנה מפורשת */
const INTENT =
  /להזמין|הזמנ(ה|ות)|לשריין|אשריין|יש\s+(?:\S+\s+){0,4}מקום|אפשר (לקבל )?(שולחן|מקום)|לסגור (שולחן|מקום)|(שולחן|מקום)\s*ל|צריכ(ה|ים)?\s+מקום/;

/** נושאים שדורשים את המודל - כל אחד מהם מבטל את המנוע */
const OFF_TOPIC =
  /תפריט|כמה עולה|מחיר|אלרג|גלוטן|טבעוני|צמחוני|כשר|חני|(?<![א-ת])לחנות|שער|תלונה|מאוכזב|נציג|לבטל|ביטול|לשנות|שינוי|הזמנתי|יש לי הזמנה|ההזמנה שלי|אישרתם|פיקדון/;

/**
 * האם בהודעה יש כוונת הזמנה חדשה מפורשת ("יש מקום הערב?", "רוצה להזמין שולחן").
 * "יש מקום לחנות?" אינה - אחרת שאלת חניה הייתה מקבלת את שערי ההזמנה.
 */
export function hasReservationIntent(text: string): boolean {
  const t = (text || "").trim();
  return INTENT.test(t) && !OFF_TOPIC.test(t);
}

/** מילות זמן שמעידות על שעת יום / ערב */
const DAY_WORDS = /בבוקר|בוקר|בצהר?יים|צהריים|אחר הצהריים|אחה"?צ|לפנות ערב/;
const EVENING_WORDS = /בערב|הערב|בלילה|לילה|ערבית/;

export type UnavailableReason =
  | "friday"
  | "saturday"
  | "sunday"
  | "daytime"
  | "closed"
  | "group"
  | "ask_size";

export interface AvailabilityAnswer {
  reason: UnavailableReason;
  text: string;
}

/**
 * "4 שולחנות של 2" = 8 סועדים. בלי זה המספר שליד "אנשים" (2) נקרא כגודל
 * הקבוצה (19.9: "30 שולחנות של 2 אנשים" נקרא כזוג).
 */
export function tablesTimesSeats(t: string): number | null {
  const m = t.match(/(?<![\d.,/])(\d{1,3}|שני|שתי)\s*שולחנות\s+(?:של|ל|עם)[-\s]?(\d{1,2})(?![:.\d])/);
  if (!m) return null;
  const tables = /^\d/.test(m[1]) ? Number(m[1]) : 2;
  const n = tables * Number(m[2]);
  return n >= 1 && n <= 1000 ? n : null;
}

/** מספר הסועדים אם צוין במפורש ("ל-4", "4 אנשים", "זוג") */
function parsePeople(t: string): number | null {
  const tables = tablesTimesSeats(t);
  if (tables !== null) return tables;
  if (/זוג(?![א-ת])|זוגי|שנינו/.test(t)) return 2;
  if (/שלושתנו/.test(t)) return 3;
  // חזק: מספר צמוד למילת כמות ("10 אנשים", "4 מקומות").
  // ה-lookbehind חוסם חצי מתאריך: "ל-7.9 אנשים" נקרא כ"9 אנשים" והופנה לברק
  // בטעות (דווח 18.9). מספר שלפניו ספרה או מפריד תאריך אינו כמות סועדים.
  const strong = t.match(/(?<![\d.,/])(\d{1,3})\s*(?:אנשים|איש(?![א-ת])|סועדים|נפשות|מקומות)/);
  if (strong) {
    const n = Number(strong[1]);
    return n >= 1 && n <= 200 ? n : null;
  }
  // "ל-4" / "ל4" = *עבור* 4 אנשים. חשוב: לא "ב-21:00" (שעה) ולא "ל-13.8" (תאריך),
  // אחרת שעה נקראת ככמות סועדים ובקשה תקינה נשלחת בטעות לברק.
  const m = t.match(/(?:^|\s)ל[-\s]?(\d{1,2})(?![:.\d])/);
  if (m) {
    const n = Number(m[1]);
    return n >= 1 && n <= 200 ? n : null;
  }
  return null;
}

/**
 * השעה המבוקשת, או null כשאי אפשר לדעת בוודאות.
 * שמרני: "בשעה 8" לבד עמום (8 בבוקר או 20:00?) ולכן לא מוכרע.
 * exact=false = הוסקה ממילה ("בערב" -> 20:00), לא נאמרה כשעה.
 */
function parseRequestedTime(t: string): { hour: number; minute: number; exact: boolean } | null {
  const hm = t.match(/(?:^|[\s\-בלמ])(\d{1,2}):(\d{2})/);
  if (hm) {
    const h = Number(hm[1]);
    const mi = Number(hm[2]);
    if (h >= 0 && h <= 23 && mi <= 59) return { hour: h, minute: mi, exact: true };
  }
  if (DAY_WORDS.test(t)) {
    if (/בבוקר|בוקר/.test(t)) return { hour: 9, minute: 0, exact: false };
    if (/לפנות ערב/.test(t)) return { hour: 17, minute: 0, exact: false };
    return { hour: 13, minute: 0, exact: false }; // צהריים / אחה"צ
  }
  if (EVENING_WORDS.test(t)) return { hour: 20, minute: 0, exact: false };
  return null;
}

function dowOf(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** שעות הפעילות של תאריך (כולל דריסות מהפאנל) בדקות, או null כשסגור כל היום */
export function openWindowFor(cfg: BusinessConfig, iso: string): OpenWindow | null {
  const range = parseHoursRange(hoursForDate(cfg, iso));
  if (!range) return null;
  const ls = lastSeatingForDate(cfg, iso);
  return { open: range.start, close: range.end, lastSeating: ls ? toMin(ls) : null };
}

/** היום הבא (אחרי iso) שבו פתוחים, או null אם לא נמצא בשבועיים הקרובים */
export function nextOpenDate(cfg: BusinessConfig, iso: string): string | null {
  for (let i = 1; i <= 14; i++) {
    const d = addDaysISO(iso, i);
    if (parseHoursRange(hoursForDate(cfg, d))) return d;
  }
  return null;
}

/** ההסבר שהוזן בפאנל לסגירה, בלי "סגור" כפול ("סגור - חג" -> "חג") */
function closureNote(cfg: BusinessConfig, iso: string): string | null {
  const raw = cfg.hoursOverrides?.find((o) => o.date === iso)?.note?.trim();
  if (!raw) return null;
  const cleaned = raw.replace(/^(סגור(ים)?|סגורה)\s*[-:,–]?\s*/, "").trim();
  return cleaned || null;
}

/** "היום" / "מחר, יום ראשון 20.9," / "ביום שני 21.9" - יחסית ליום שבו עונים */
function dayLead(iso: string, todayISO: string): string {
  if (iso === todayISO) return "היום";
  if (iso === addDaysISO(todayISO, 1)) return `מחר, ${formatDayHe(iso)},`;
  return `ב${formatDayHe(iso)}`;
}

/** "מחר, יום שלישי 22.9" / "ביום שלישי 22.9" - למשפט "נפתח שוב ..." */
function reopenRef(iso: string, todayISO: string): string {
  if (iso === addDaysISO(todayISO, 1)) return `מחר, ${formatDayHe(iso)}`;
  return `ב${formatDayHe(iso)}`;
}

function israelISO(now: Date): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

/**
 * התשובה הקבועה לתאריך סגור שאינו שבת (חג, סגירה חריגה מהפאנל).
 * עד 19.9 זה היה "בתאריך הזה אנחנו סגורים 🙂" - בלי תאריך, בלי סיבה ובלי מתי
 * נפתחים, והלקוח נאלץ לשאול "איזה תאריך?".
 */
export function closedDayText(cfg: BusinessConfig, iso: string, now: Date = new Date()): string {
  const today = israelISO(now);
  const note = closureNote(cfg, iso);
  const next = nextOpenDate(cfg, iso);
  return (
    `${dayLead(iso, today)} אנחנו סגורים${note ? ` (${note})` : ""} 🙂` +
    (next ? `\nנפתח שוב ${reopenRef(next, today)}.` : "")
  );
}

/**
 * נוסח השבת של בעל העסק מזמין "ביום ראשון". כשראשון שאחרי סגור (ערב יום
 * כיפור, 20.9) - מזמינים ליום הפתוח הבא במקום, וכל השאר נשאר מילה במילה.
 */
export function saturdayClosedText(cfg: BusinessConfig, iso: string, now: Date = new Date()): string {
  const sunday = addDaysISO(iso, 1);
  if (parseHoursRange(hoursForDate(cfg, sunday))) return RESERVATION_TEXTS.saturday;
  const next = nextOpenDate(cfg, iso);
  if (!next) return RESERVATION_TEXTS.saturday;
  return RESERVATION_TEXTS.saturday.replace("ביום ראשון", reopenRef(next, israelISO(now)));
}

interface PolicyInput {
  dateISO: string;
  hour: number | null;
  minute?: number;
  /** האם לבדוק את השעה מול שעות הפעילות (רק כשהשעה נאמרה או הוסקה מהטקסט) */
  checkHours: boolean;
  people: number | null;
}

function decideFor(cfg: BusinessConfig, q: PolicyInput): PolicyDecision {
  return decideReservation({
    dayOfWeek: dowOf(q.dateISO),
    openThatDay: !!hoursForDate(cfg, q.dateISO),
    hour: q.hour,
    minute: q.minute,
    people: q.people,
    window: q.checkHours ? openWindowFor(cfg, q.dateISO) : null,
  });
}

/**
 * מחזיר תשובה קבועה כשאפשר להכריע בקוד, או null כשהשיחה צריכה להמשיך למודל
 * (משבצת תקינה להזמנה, שעה שבה סגורים, או חוסר מידע שהמודל יברר).
 */
export function checkReservationAvailability(
  raw: string,
  cfg: BusinessConfig,
  now: Date = new Date()
): AvailabilityAnswer | null {
  const t = (raw || "").trim();
  if (!t || t.length > 200) return null;
  if (!INTENT.test(t)) return null;
  if (OFF_TOPIC.test(t)) return null;

  const people = parsePeople(t);
  const iso = resolveReservationDate(t, undefined, now);

  // בלי יום שניתן לפענח אי אפשר להכריע - חוץ ממקרה אחד: קבוצה גדולה הולכת
  // לברק בכל יום, ולכן מותר לענות עליה גם בלי לדעת מתי.
  if (!iso) {
    if (people !== null && people >= GROUP_MIN_FOR_BARAK) {
      return { reason: "group", text: RESERVATION_TEXTS.barak };
    }
    return null;
  }

  const dow = dowOf(iso);

  // שעה מהטקסט; ואם אין - מקרה אחד בטוח: "יש מקום להיום?" כשעכשיו עוד יום.
  // שם השעה הנוכחית היא הכוונה בפועל, וכל שאר המקרים נשארים "לא ידוע".
  // שעה שהוסקה מהשעון לא נבדקת מול שעות הפתיחה: "יש מקום היום?" ב-07:30 הוא
  // לא בקשה להגיע ב-07:30.
  const req = parseRequestedTime(t);
  let hour = req?.hour ?? null;
  if (hour === null && BOOKING_DAYS.includes(dow)) {
    const nowHour = Number(
      new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", hour12: false }).format(now)
    );
    if (iso === israelISO(now) && nowHour < BOOKING_FROM_HOUR) hour = nowHour;
  }

  const decision = decideFor(cfg, { dateISO: iso, hour, minute: req?.minute, checkHours: !!req, people });
  // "book" / "defer" / "closed_hour" - אין תשובה קבועה, השיחה ממשיכה למודל
  if (!decision.text) return null;

  if (decision.verdict === "closed") {
    return dow === 6
      ? { reason: "saturday", text: saturdayClosedText(cfg, iso, now) }
      : { reason: "closed", text: closedDayText(cfg, iso, now) };
  }

  const reason: UnavailableReason =
    decision.verdict === "barak"
      ? "group"
      : decision.verdict === "ask_size"
        ? "ask_size"
        : dow === 5
          ? "friday"
          : dow === 0
            ? "sunday"
            : "daytime";

  return { reason, text: decision.text };
}

/** הפרטים שנאספו בשיחה (reservation-slots.ts) - רק מה שנחוץ להכרעה */
export interface SlotsForVerdict {
  dateISO?: string;
  /** "20:00" */
  time?: string;
  people?: number;
}

export interface VerdictLine {
  verdict: PolicyDecision["verdict"];
  line: string | null;
}

/**
 * שורת ההכרעה למודל, לפי כל מה שנאסף בשיחה עד עכשיו (19.9).
 *
 * המודל קיבל עד כה רק את הטבלה, וטעה בהצלבה שלה עם שעות הפתיחה: "ראשון =
 * מקום פנוי" נקרא גם על 20:00. כאן הקוד מצליב (יום + שעה + גודל + שעות
 * הפעילות של אותו תאריך) ומוסר תשובה מוכנה. null כשאין עוד יום.
 */
export function policyVerdictFor(cfg: BusinessConfig, s: SlotsForVerdict, now: Date = new Date()): VerdictLine | null {
  if (!s.dateISO || !/^\d{4}-\d{2}-\d{2}$/.test(s.dateISO)) return null;
  const iso = s.dateISO;
  const hm = s.time?.match(/^(\d{1,2}):(\d{2})$/);
  const hour = hm ? Number(hm[1]) : null;
  const minute = hm ? Number(hm[2]) : undefined;
  const decision = decideFor(cfg, { dateISO: iso, hour, minute, checkHours: !!hm, people: s.people ?? null });
  const when = `${formatDayHe(iso)}${s.time ? ` בשעה ${s.time}` : ""}`;
  const head = `הכרעת המדיניות ל${when}, מחושבת בקוד מהטבלה ומשעות הפעילות של אותו תאריך (אל תכריע בעצמך):`;
  const today = israelISO(now);
  const dow = dowOf(iso);

  switch (decision.verdict) {
    case "closed": {
      const note = closureNote(cfg, iso);
      const next = nextOpenDate(cfg, iso);
      return {
        verdict: "closed",
        line:
          `${head} 🔒 **סגורים כל היום**${note ? ` (${note})` : ""}` +
          (next ? `, ונפתחים שוב ${reopenRef(next, today)}` : "") +
          `. אמור את זה בקצרה, עם היום והתאריך${note ? " והסיבה" : ""}, ואל תציע לבוא או לשריין לתאריך הזה.`,
      };
    }
    case "closed_hour": {
      const hours = hoursForDate(cfg, iso);
      const ls = lastSeatingForDate(cfg, iso);
      return {
        verdict: "closed_hour",
        line:
          `${head} ⏰ **בשעה הזו אנחנו סגורים** - באותו יום פתוחים ${hours}${ls ? ` (הושבה אחרונה ${ls})` : ""}. ` +
          `**אסור להזמין אותו להגיע בשעה הזו, ואסור לומר לגביה "מגיעים על בסיס מקום פנוי" או "אין צורך להזמין".** ` +
          `אמור לו בפשטות מה שעות הפעילות באותו יום, בלי לסתור את עצמך באותה הודעה, ואם מתאים הצע שעה אחרת או יום אחר.`,
      };
    }
    case "barak":
      return { verdict: "barak", line: `${head} ➡️ ברק - הנוסח של ברק מהטבלה בלבד.` };
    case "walk_in": {
      const which = dow === 5 ? "שישי" : dow === 0 ? "ראשון" : "שני-חמישי לפני 18:00";
      return {
        verdict: "walk_in",
        line: `${head} 🚶 מקום פנוי - הנוסח של ${which} מהטבלה, בלי איסוף פרטים ובלי הכלי.`,
      };
    }
    case "book":
      return { verdict: "book", line: `${head} ✅ אפשר לשריין כאן בצ'אט - המשך באיסוף מה שחסר.` };
    default:
      // ask_size / defer - שערי הכמות והמודל מטפלים
      return { verdict: decision.verdict, line: null };
  }
}
