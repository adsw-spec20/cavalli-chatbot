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
 * שממנו נבנה גם הפרומפט). כאן רק הפענוח: האם זו בכלל בקשת הזמנה, לאיזה יום,
 * לאיזו שעה וכמה סועדים.
 *
 * שמרני בכוונה: עונה רק כשיש כוונת הזמנה מפורשת *וגם* יום שניתן לפענח
 * חד-משמעית. כל ספק - מחזיר null והשיחה ממשיכה למודל כרגיל.
 */

import type { BusinessConfig } from "./business-config";
import { resolveReservationDate } from "./reservations";
import {
  decideReservation,
  BOOKING_DAYS,
  BOOKING_FROM_HOUR,
  GROUP_MIN_FOR_BARAK,
  RESERVATION_TEXTS,
} from "./reservation-policy";

/** כוונת הזמנה מפורשת */
const INTENT =
  /להזמין|הזמנ(ה|ות)|לשריין|אשריין|יש\s+(?:\S+\s+){0,4}מקום|אפשר (לקבל )?(שולחן|מקום)|לסגור (שולחן|מקום)|(שולחן|מקום)\s*ל|צריכ(ה|ים)?\s+מקום/;

/** נושאים שדורשים את המודל - כל אחד מהם מבטל את המנוע */
const OFF_TOPIC =
  /תפריט|כמה עולה|מחיר|אלרג|גלוטן|טבעוני|צמחוני|כשר|חני|שער|תלונה|מאוכזב|נציג|לבטל|ביטול|לשנות|שינוי|הזמנתי|יש לי הזמנה|ההזמנה שלי|אישרתם|פיקדון/;

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

/** מספר הסועדים אם צוין במפורש ("ל-4", "4 אנשים", "זוג") */
function parsePeople(t: string): number | null {
  if (/זוג(?![א-ת])|זוגי|שנינו/.test(t)) return 2;
  if (/שלושתנו/.test(t)) return 3;
  // חזק: מספר צמוד למילת כמות ("10 אנשים", "4 מקומות")
  const strong = t.match(/(\d{1,3})\s*(?:אנשים|איש(?![א-ת])|סועדים|נפשות|מקומות)/);
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
 * השעה המבוקשת בשעות שלמות, או null כשאי אפשר לדעת בוודאות.
 * שמרני: "בשעה 8" לבד עמום (8 בבוקר או 20:00?) ולכן לא מוכרע.
 */
function parseHour(t: string): number | null {
  const hm = t.match(/(?:^|[\s\-בלמ])(\d{1,2}):(\d{2})/);
  if (hm) {
    const h = Number(hm[1]);
    if (h >= 0 && h <= 23) return h;
  }
  if (DAY_WORDS.test(t)) {
    if (/בבוקר|בוקר/.test(t)) return 9;
    if (/לפנות ערב/.test(t)) return 17;
    return 13; // צהריים / אחה"צ
  }
  if (EVENING_WORDS.test(t)) return 20;
  return null;
}

/** שעות הפעילות לתאריך נתון (כולל שעות חריגות שהוזנו בפאנל) */
function hoursFor(cfg: BusinessConfig, iso: string): string | null {
  const override = cfg.hoursOverrides?.find((o) => o.date === iso);
  if (override) return override.hours;
  const [y, m, d] = iso.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const heDay = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"][dow];
  return cfg.hours.find((h) => h.day === heDay)?.hours ?? null;
}

/** השעה הנוכחית בישראל, בשעות שלמות */
function nowHourIL(now: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", hour12: false }).format(now)
  );
}

/**
 * מחזיר תשובה קבועה כשאפשר להכריע בקוד, או null כשהשיחה צריכה להמשיך למודל
 * (משבצת תקינה להזמנה, או חוסר מידע שהמודל יברר).
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
  // לברק בכל יום ובכל שעה, ולכן מותר לענות עליה גם בלי לדעת מתי.
  if (!iso) {
    if (people !== null && people >= GROUP_MIN_FOR_BARAK) {
      return { reason: "group", text: RESERVATION_TEXTS.barak };
    }
    return null;
  }

  const [y, m, d] = iso.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();

  // שעה מפורשת; ואם אין - מקרה אחד בטוח: "יש מקום להיום?" כשעכשיו עוד יום.
  // שם השעה הנוכחית היא הכוונה בפועל, וכל שאר המקרים נשארים "לא ידוע".
  let hour = parseHour(t);
  if (hour === null && BOOKING_DAYS.includes(dow)) {
    const isToday = iso === now.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
    const nowHour = nowHourIL(now);
    if (isToday && nowHour < BOOKING_FROM_HOUR) hour = nowHour;
  }

  const decision = decideReservation({
    dayOfWeek: dow,
    openThatDay: !!hoursFor(cfg, iso),
    hour,
    people,
  });
  // "book" / "defer" - אין תשובה קבועה, השיחה ממשיכה למודל
  if (!decision.text) return null;

  const reason: UnavailableReason =
    decision.verdict === "barak"
      ? "group"
      : decision.verdict === "ask_size"
        ? "ask_size"
        : decision.verdict === "closed"
          ? dow === 6
            ? "saturday"
            : "closed"
          : dow === 5
            ? "friday"
            : dow === 0
              ? "sunday"
              : "daytime";

  return { reason, text: decision.text };
}
