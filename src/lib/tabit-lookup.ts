/**
 * זיהוי הזמנה קיימת מול העותק החי של טאביט.
 *
 * למה זה קיים: רוב ההזמנות נעשות בטאביט (אונליין/טלפון) והבוט היה עיוור להן
 * לחלוטין, כך שגם כלל 24 השעות לא יכול היה לעבוד עליהן - בלי לדעת את המועד
 * הכל נפל אוטומטית למסלול הטלפון.
 *
 * ⚠️ הכלל המרכזי כאן הוא פרטיות, והוא נאכף **בקוד ולא בפרומפט**: המודל לא
 * מקבל לעולם נתוני הזמנה שלא אומתו. טלפון הוא לא הוכחת זהות - מי שמקליד
 * מספר של אדם אחר היה מקבל שם מלא, תאריך, שעה וכמות אנשים. לכן:
 *
 *   מסלול א' (verified): וואטסאפ, והמספר שממנו הלקוח כותב הוא המספר שבהזמנה.
 *                        Meta מאמתת את המספר, ולכן זו זהות אמיתית.
 *   מסלול ב' (matched):  כל השאר. נדרשת התאמה של **שלושה** פרטים שהלקוח מסר
 *                        בעצמו: טלפון מדויק, שם (גם חלקי), ותאריך.
 *
 * כל מה שלא נכנס לאחד מאלה - הקוד מחזיר null, והמודל לא רואה כלום.
 */

import { getRepo } from "./db";

export interface TabitReservation {
  id?: string;
  name?: string;
  phone?: string;
  seats?: number;
  day?: string;   // YYYY-MM-DD
  time?: string;  // HH:MM
  state?: string;
  type?: string;
  tables?: number[];
}

/**
 * נרמול מספר ישראלי להשוואה: מסיר מקפים/רווחים/סוגריים, ממיר 972 ל-0.
 * בלי זה "052-848-7546" ו-"972528487546" נחשבים שונים והתאמות אמיתיות נכשלות.
 */
export function normalizePhone(raw?: string | null): string {
  if (!raw) return "";
  let d = String(raw).replace(/\D/g, "");
  if (d.startsWith("972")) d = "0" + d.slice(3);
  if (d.length === 9 && !d.startsWith("0")) d = "0" + d;
  return d;
}

/**
 * גיל מרבי של העותק שעדיין מותר להסתמך עליו לזיהוי, במילישניות.
 *
 * הגשר לטאביט הוא תהליך Playwright שרץ על מחשב מקומי ומעדכן כל 2-15 שניות,
 * כך שגיל של שעתיים פירושו שהוא נפל. עותק ישן מסוכן בכיוון אחד ספציפי:
 * הזמנה שבוטלה אתמול עדיין תופיע בו כפעילה, והבוט יאשר ללקוח הזמנה שלא
 * קיימת. הכיוון ההפוך (הזמנה חדשה שחסרה) פשוט מפיל אותנו להעברה לצוות,
 * שזו ממילא התנהגות תקינה. לכן עדיף לוותר על הזיהוי מאשר לאשר מידע שגוי.
 */
const MAX_SNAPSHOT_AGE_MS = 2 * 60 * 60_000;

/** שולף את העותק של טאביט. מחזיר מערך ריק אם אין snapshot, הוא פגום, או ישן מדי. */
export async function loadTabitReservations(): Promise<TabitReservation[]> {
  try {
    const raw = await getRepo().getSetting("tabit_snapshot");
    if (!raw) return [];
    const snap = JSON.parse(raw) as { reservations?: TabitReservation[]; generatedAt?: number };
    if (!snap.generatedAt || Date.now() - snap.generatedAt > MAX_SNAPSHOT_AGE_MS) return [];
    return Array.isArray(snap.reservations) ? snap.reservations : [];
  } catch {
    return [];
  }
}

/** התאמת שם: חלקית ובשני הכיוונים. "שלומי" יתאים ל"שלומי כהן" ולהפך. */
export function matchesName(said: string, reservationName?: string): boolean {
  const a = (reservationName ?? "").trim();
  if (!a) return false;
  const norm = (s: string) => s.replace(/[^\p{L}\s]/gu, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const full = norm(a);
  if (!full) return false;
  const parts = full.split(" ").filter((w) => w.length >= 2);
  const hay = norm(said);
  if (!hay) return false;
  // מספיק ששם פרטי או משפחה מהרשומה מופיע בדברי הלקוח
  return parts.some((w) => hay.includes(w)) || (full.length >= 2 && hay.includes(full));
}

const HEB_DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

/**
 * התאמת תאריך: מקבלת גם "18.9", גם "18/9", וגם "יום חמישי" (מחושב מהתאריך
 * של ההזמנה עצמה). דורשת שהלקוח יאמר משהו שמצביע על אותו יום.
 */
export function matchesDate(said: string, day?: string): boolean {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const [, m, d] = day.split("-").map(Number) as unknown as [number, number, number];
  const text = said.replace(/\s+/g, " ");
  // 18.9 / 18/9 / 18.09 - עם או בלי אפס מוביל
  const dd = String(d), mm = String(m);
  const numeric = new RegExp(`(^|[^\\d])0?${dd}[./-]0?${mm}([^\\d]|$)`);
  if (numeric.test(text)) return true;
  // "יום חמישי" - רק אם הוא באמת היום של ההזמנה
  const dow = new Date(`${day}T12:00:00+03:00`).getDay();
  const name = HEB_DAYS[dow];
  if (name && new RegExp(`יום\\s+${name}|^${name}$|\\s${name}\\s`).test(text)) return true;
  return false;
}

export type IdentityLevel = "verified" | "matched";

export interface IdentifyResult {
  level: IdentityLevel;
  reservation: TabitReservation;
}

export interface IdentifyInput {
  /** המספר שממנו הלקוח כותב, אם הערוץ מאמת אותו (וואטסאפ בלבד) */
  verifiedPhone?: string;
  /** כל מה שהלקוח כתב בשיחה - ממנו מחלצים טלפון/שם/תאריך שהוא מסר */
  customerText: string;
  reservations: TabitReservation[];
}

/** מספרי טלפון שהופיעו בטקסט של הלקוח */
export function phonesIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:\+?972|0)[\d\-\s()]{8,13}/g)) {
    const n = normalizePhone(m[0]);
    if (/^0\d{9}$/.test(n)) out.add(n);
  }
  return [...out];
}

/**
 * מחזיר הזמנה מזוהה, או מידע שיש כמה מועמדות (בלי לחשוף אותן), או null.
 *
 * multiple=true אומר למודל לבקש מהלקוח תאריך - **בלי למנות את ההזמנות**.
 * זו דרישה מפורשת: הלקוח הוא שמזהה את ההזמנה, לא אנחנו.
 */
export function identifyReservation(
  input: IdentifyInput
): { result?: IdentifyResult; multiple?: boolean } {
  const { verifiedPhone, customerText, reservations } = input;
  if (!reservations.length) return {};

  // --- מסלול א': המספר שממנו הוא כותב הוא המספר שבהזמנה ---
  const vp = normalizePhone(verifiedPhone);
  if (vp) {
    const mine = reservations.filter((r) => normalizePhone(r.phone) === vp);
    if (mine.length === 1) return { result: { level: "verified", reservation: mine[0] } };
    if (mine.length > 1) return { multiple: true };
  }

  // --- מסלול ב': שלושה פרטים שהלקוח מסר בעצמו ---
  const said = phonesIn(customerText);
  if (!said.length) return {};
  const byPhone = reservations.filter((r) => said.includes(normalizePhone(r.phone)));
  if (!byPhone.length) return {};
  const full = byPhone.filter(
    (r) => matchesName(customerText, r.name) && matchesDate(customerText, r.day)
  );
  if (full.length === 1) return { result: { level: "matched", reservation: full[0] } };
  if (full.length > 1) return { multiple: true };
  return {};
}

/** "יום רביעי 16.9" - לתצוגה בתוך ההקשר שנשלח למודל */
function hebrewDateText(day?: string): string {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  const [, m, d] = day.split("-").map(Number) as unknown as [number, number, number];
  const dow = new Date(`${day}T12:00:00+03:00`).getDay();
  return `יום ${HEB_DAYS[dow]} ${d}.${m}`;
}

/** האם השיחה בכלל נוגעת להזמנה קיימת - שלא נריץ חיפוש על כל "מה שעות הפתיחה" */
export function mentionsExistingReservation(text: string): boolean {
  return /הזמנ|הזמנתי|שריינ|רזרב|להזיז|לשנות|שינוי|לבטל|ביטול|לעדכן|להקדים|לאחר|שולחן/.test(text);
}

export interface IdentityHintInput {
  channel: string;
  /** המזהה בערוץ. בוואטסאפ זה מספר הטלפון, וMeta מאמתת אותו. */
  channelUserId: string;
  /** מה שהלקוח עצמו כתב בשיחה */
  customerText: string;
  /** תאריך היום בישראל (YYYY-MM-DD) - לסינון הזמנות שכבר עברו */
  today: string;
  /** חישוב חלון 24 השעות, נעשה בקוד של conversation-service */
  windowLabel: (r: { dateISO?: string; time?: string }) => string;
}

/**
 * בונה את שורת ההקשר על ההזמנה בטאביט, או undefined אם אין מה לומר.
 *
 * כל ניסוח כאן נכתב מתוך הנחה שהמודל **יציית לו מילולית**, ולכן הוא מפרט
 * לא רק מה מותר לומר אלא גם מה אסור לרמוז. במיוחד: כשאין התאמה, אסור לגלות
 * אם המספר בכלל קיים ביומן - אחרת החיפוש עצמו הופך לכלי דליפה.
 */
export async function tabitIdentityHint(input: IdentityHintInput): Promise<string | undefined> {
  return buildIdentityHint(await loadTabitReservations(), input);
}

/**
 * החלק הטהור: אותה לוגיקה בדיוק, בלי גישה למסד. מופרד כדי שאפשר יהיה לבדוק
 * אותו באמת - כל מסלולי הפרטיות נבדקים ב-scripts/tabit-lookup-test.mts.
 */
export function buildIdentityHint(all: TabitReservation[], input: IdentityHintInput): string | undefined {
  const { channel, channelUserId, customerText, today, windowLabel } = input;
  if (!mentionsExistingReservation(customerText)) return undefined;

  // ⚠️ הגשר משאיר ב-snapshot גם הזמנות שבוטלו (הוא מסנן רק walk-in), ולכן
  // הסינון הזה הוא מה שמונע מהבוט לאשר ללקוח הזמנה שכבר בוטלה.
  const upcoming = all.filter(
    (r) => r.day && r.day >= today && r.state !== "cancelled" && r.type !== "walked_in"
  );
  if (!upcoming.length) return undefined;

  const { result, multiple } = identifyReservation({
    verifiedPhone: channel === "whatsapp" ? channelUserId : undefined,
    customerText,
    reservations: upcoming,
  });

  if (result) {
    const r = result.reservation;
    const label = windowLabel({ dateISO: r.day, time: r.time });
    const core = `ע"ש ${r.name ?? "לא ידוע"}, ${hebrewDateText(r.day)} בשעה ${r.time ?? "לא ידועה"}, ${r.seats ?? "?"} אנשים [${label}]`;
    if (result.level === "verified") {
      return `[יומן ההזמנות - נמצאה הזמנה רשומה על המספר שממנו הלקוח כותב עכשיו בוואטסאפ, כלומר הזהות ודאית: ${core}. התייחס אליה ישירות, אל תבקש ממנו פרטי זיהוי, ומותר לך לאשר לו את הפרטים האלה.]`;
    }
    return `[יומן ההזמנות - הפרטים שהלקוח מסר (שם, טלפון ותאריך) תואמים להזמנה: ${core}. מותר לאשר לו שההזמנה קיימת ולהמשיך לטפל בבקשה. את השעה וכמות האנשים אמור **רק אם הוא שואל עליהן במפורש**.]`;
  }

  if (multiple) {
    return `[יומן ההזמנות - יותר מהזמנה אחת מתאימה לפרטים שיש עד כה. אסור למנות אותן, לתאר אותן, או לרמוז כמה יש. בקש מהלקוח בטבעיות לאיזה תאריך ההזמנה שלו.]`;
  }

  // אין התאמה. מפרידים בין "עוד לא מסר כלום" לבין "מסר ועדיין לא נסגר",
  // ועוצרים אחרי שלושה מספרים שונים כדי שהשיחה לא תהפוך לחקירה.
  const tried = phonesIn(customerText);
  if (!tried.length) return undefined;
  if (tried.length >= 3) {
    return `[יומן ההזמנות - כבר נמסרו שלושה מספרים שונים ואין התאמה. אל תבקש עוד פרטים. העבר לצוות (escalate_to_human) עם כל מה שנמסר עד כה. אל תאמר "לא מצאתי" ואל תרמז אם מספר כלשהו קיים ביומן.]`;
  }
  return `[יומן ההזמנות - עדיין אין התאמה ודאית לפרטים שנמסרו. אל תאמר "לא מצאתי", ואל תרמז ללקוח אם המספר שמסר קיים ביומן או לא. אם חסר פרט (שם ההזמנה / התאריך / הטלפון) בקש אותו בטבעיות; אם כבר ביקשת ולא התקדמנו - העבר לצוות עם כל מה שנמסר.]`;
}
