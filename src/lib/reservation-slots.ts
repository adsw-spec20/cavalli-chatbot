/**
 * חילוץ פרטי הזמנה מהשיחה - כרמז למודל, לא כתחליף לו.
 *
 * הרעיון: הקוד קורא את הודעות הלקוח ומזהה מה כבר נמסר (כמה אנשים, מתי, איפה
 * לשבת, שם, טלפון), ומעביר למודל רשימה מסודרת של "מה ידוע ומה חסר". המודל
 * ממשיך לנהל את השיחה במילים שלו - אבל כבר לא שואל פעמיים את אותו דבר ולא
 * מתבלבל בפרטים (בביקורת נמצאה שיחה שבה הלקוח טען שסוכם שינוי והבוט לא ידע על
 * שום הזמנה, ושיחות שבהן התאריך נדד).
 *
 * ⚠️ עיקרון ברזל: זו *הצעה*. השיחה עצמה היא המקור האמין, והמודל מקבל הוראה
 * מפורשת להתעלם מהרמז כשהוא סותר את מה שהלקוח כתב. לכן טעות חילוץ לא יכולה
 * להפוך לפרט שגוי בכרטיס - היא לכל היותר רמז שהמודל מתעלם ממנו.
 */

import { resolveReservationDate } from "./reservations";
import type { ConversationMessage } from "./channels/types";

export interface ReservationSlots {
  people?: number;
  dateISO?: string;
  time?: string;
  seating?: "בפנים" | "בחוץ";
  name?: string;
  phone?: string;
  /** מה עוד חסר כדי לסכם בקשה */
  missing: string[];
}

/** האם השיחה נמצאת בזרימת הזמנה (ולכן שווה לחלץ פרטים) */
const FLOW_MARKERS =
  /להזמין|הזמנ(ה|ות)|לשריין|אשריין|שולחן|מקום ל|כמה תהיו|על שם מי|בפנים או בחוץ|טאביט/i;

export function looksLikeReservationFlow(messages: ConversationMessage[]): boolean {
  return messages.slice(-8).some((m) => FLOW_MARKERS.test(m.content));
}

function parsePeople(t: string): number | undefined {
  if (/זוג(?![א-ת])|זוגי/.test(t)) return 2;
  const strong = t.match(/(\d{1,3})\s*(?:אנשים|איש(?![א-ת])|סועדים|נפשות|מקומות)/);
  if (strong) {
    const n = Number(strong[1]);
    if (n >= 1 && n <= 200) return n;
  }
  // "ל-4" אבל לא שעה ("ל-20:00") ולא תאריך ("ל-13.8")
  const m = t.match(/(?:^|\s)ל[-\s]?(\d{1,2})(?![:.\d])/);
  if (m) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 200) return n;
  }
  return undefined;
}

/** שעה בפורמט אחיד ("20:00"). מחזיר undefined כשלא ברור. */
function parseTime(t: string): string | undefined {
  const hm = t.match(/(?:^|[\s\-בלמ])(\d{1,2}):(\d{2})/);
  if (hm) {
    const h = Number(hm[1]);
    const mi = Number(hm[2]);
    if (h <= 23 && mi <= 59) return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
  }
  // "ב-8 וחצי בערב" / "בשעה 8 בערב" - רק כשיש הקשר ערב, אחרת עמום מדי
  const evening = /בערב|הערב|בלילה/.test(t);
  const bare = t.match(/(?:בשעה|ב)[-\s]?(\d{1,2})(?:\s*ו(חצי|רבע))?/);
  if (bare && evening) {
    let h = Number(bare[1]);
    if (h >= 1 && h <= 11) h += 12;
    if (h >= 12 && h <= 23) return `${String(h).padStart(2, "0")}:${bare[2] === "חצי" ? "30" : bare[2] === "רבע" ? "15" : "00"}`;
  }
  return undefined;
}

function parseName(t: string): string | undefined {
  const m =
    t.match(/על שם\s+([א-ת]{2,15})/) ??
    t.match(/(?:קוראים לי|השם שלי|אני)\s+([א-ת]{2,15})(?![א-ת])/);
  if (!m) return undefined;
  const name = m[1];
  // מילים נפוצות שאינן שם
  if (/^(רוצה|צריך|צריכה|מעוניין|מחפש|מחפשת|יכול|יכולה|בא|באה|אשמח|כאן|שם)$/.test(name)) return undefined;
  return name;
}

function parsePhone(t: string): string | undefined {
  const m = t.match(/0\d{1,2}[-\s]?\d{7}(?!\d)/);
  return m ? m[0].replace(/[-\s]/g, "") : undefined;
}

/**
 * סורק את הודעות הלקוח (החדשה ביותר מנצחת) ומחזיר את מה שכבר נמסר.
 * ההודעות של הבוט לא נסרקות בכוונה - כדי שהצעה שלו ("על שם מי?") לא תיקרא
 * כאילו הלקוח כבר ענה, ושמספרי הטלפון של המסעדה לא ייקלטו כטלפון הלקוח.
 */
export function extractReservationSlots(messages: ConversationMessage[]): ReservationSlots {
  const userTexts = messages.filter((m) => m.role === "user").map((m) => m.content);
  const slots: ReservationSlots = { missing: [] };

  for (const t of userTexts) {
    const people = parsePeople(t);
    if (people !== undefined) slots.people = people;
    const iso = resolveReservationDate(t, undefined);
    if (iso) slots.dateISO = iso;
    const time = parseTime(t);
    if (time) slots.time = time;
    if (/בפנים|פנימי|בתוך/.test(t)) slots.seating = "בפנים";
    else if (/בחוץ|חיצוני|בגינה|בחצר/.test(t)) slots.seating = "בחוץ";
    const name = parseName(t);
    if (name) slots.name = name;
    const phone = parsePhone(t);
    if (phone) slots.phone = phone;
  }

  if (slots.people === undefined) slots.missing.push("כמה אנשים");
  if (!slots.dateISO) slots.missing.push("תאריך");
  if (!slots.time) slots.missing.push("שעה");
  if (!slots.seating) slots.missing.push("ישיבה (בפנים/בחוץ)");
  if (!slots.name) slots.missing.push("שם");
  if (!slots.phone) slots.missing.push("טלפון");
  return slots;
}

const HE_DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

/** הרמז כפי שהוא נשלח למודל. null = אין מה לומר (לא נמסר שום פרט). */
export function reservationSlotsHint(slots: ReservationSlots): string | null {
  const known: string[] = [];
  if (slots.people !== undefined) known.push(`${slots.people} אנשים`);
  if (slots.dateISO) {
    const [y, m, d] = slots.dateISO.split("-").map(Number);
    known.push(`יום ${HE_DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d}.${m}`);
  }
  if (slots.time) known.push(`בשעה ${slots.time}`);
  if (slots.seating) known.push(`ישיבה ${slots.seating}`);
  if (slots.name) known.push(`על שם ${slots.name}`);
  if (slots.phone) known.push(`טלפון ${slots.phone}`);
  if (!known.length) return null;

  return (
    `פרטי הזמנה שכבר נמסרו בשיחה (חולצו אוטומטית - אם זה סותר את מה שהלקוח כתב, ` +
    `השיחה עצמה קובעת ואתה מתעלם מהשורה הזאת): ${known.join(" · ")}. ` +
    (slots.missing.length ? `עוד חסר: ${slots.missing.join(", ")}.` : `הכל נאסף - אפשר לסכם ולבקש אישור.`)
  );
}
