/**
 * מנוע זמינות הזמנות - תשובה דטרמיניסטית לבקשות שאי אפשר לקבל.
 *
 * למה בקוד ולא במודל: 10% מהתשובות ששולמו (22 ב-3 ימים) היו בקשות ליום ושעה
 * שבהם אין הזמנות בכלל ("יש מקום להיום?", "מקום למחר בבוקר", "להזמין לשישי").
 * התשובה בכל המקרים האלה זהה, וניתנת לחישוב מהיום והשעה - בדיוק כמו "פתוחים
 * עכשיו?". חשוב מזה: זה בדיוק המקום שהמודל הכי טעה בו בעבר (לקח הזמנות לשישי,
 * לראשון בערב ולשעות היום), וקוד לא טועה בזה.
 *
 * כלל האמת: הזמנות מראש רק שני-חמישי, מ-18:00, עד 8 סועדים.
 *
 * שמרני בכוונה: עונה רק כשיש כוונת הזמנה מפורשת *וגם* יום שניתן לפענח
 * חד-משמעית. כל ספק - מחזיר null והשיחה ממשיכה למודל כרגיל.
 */

import type { BusinessConfig } from "./business-config";
import { resolveReservationDate } from "./reservations";

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
  | "group";

export interface AvailabilityAnswer {
  reason: UnavailableReason;
  text: string;
}

/** מספר הסועדים אם צוין במפורש ("ל-4", "4 אנשים", "זוג") */
function parsePeople(t: string): number | null {
  if (/זוג(?![א-ת])|זוגי/.test(t)) return 2;
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

// בלי אימוג'י בסוף: השורה שלפניה כבר נגמרת באחד, ושני סמיילים בהודעה של שתי
// שורות נראה מוגזם (נראה בוואטסאפ חי 24.8).
const EVENING_OFFER =
  "אם תרצו לשריין שולחן מראש, אפשר לערבי שני-חמישי מ-18:00 - ואשמח לסדר את זה כאן בצ'אט.";

/** "מחר" / "היום" / "ביום שלישי" - כדי שהתשובה תרגיש כמו מענה לשאלה ולא כמו עלון */
function whenLabel(iso: string, now: Date): string {
  const today = now.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
  if (iso === today) return "היום";
  const [y, m, d] = today.split("-").map(Number);
  const tomorrow = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  if (iso === tomorrow) return "מחר";
  const [iy, im, id] = iso.split("-").map(Number);
  const dow = new Date(Date.UTC(iy, im - 1, id)).getUTCDay();
  return `ביום ${["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"][dow]}`;
}

/**
 * מחזיר תשובה קבועה כשאי אפשר להזמין בזמן המבוקש, או null כשהבקשה תקינה
 * (או שלא הצלחנו להכריע) - ואז השיחה ממשיכה למודל כרגיל.
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

  // קבוצה גדולה -> ברק, בלי קשר ליום ולשעה
  const people = parsePeople(t);
  if (people !== null && people > 8) {
    return {
      reason: "group",
      text:
        `לקבוצה בגודל כזה הכי נוח לתאם ישירות מול ברק, איש הקשר שלנו לקבוצות ואירועים: *050-236-6466* 🙂\n` +
        `הוא ייתן לכם את כל הפרטים.`,
    };
  }

  // חייב יום שניתן לפענח חד-משמעית - אחרת למודל
  const iso = resolveReservationDate(t, undefined, now);
  if (!iso) return null;

  const [y, m, d] = iso.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const hours = hoursFor(cfg, iso);

  // סגור לגמרי באותו יום (כולל שעות חריגות שהוזנו בפאנל)
  if (!hours) {
    if (dow === 6) {
      return {
        reason: "saturday",
        text: `בשבת אנחנו סגורים 🙂 פתוחים שוב ביום ראשון.\n${EVENING_OFFER}`,
      };
    }
    return {
      reason: "closed",
      text: `בתאריך הזה אנחנו סגורים 🙂\n${EVENING_OFFER}`,
    };
  }

  if (dow === 5) {
    return {
      reason: "friday",
      text:
        `בימי שישי אנחנו לא לוקחים הזמנות מראש - מגיעים ויושבים על בסיס מקום פנוי, ופתוחים עד 15:00 🙂\n` +
        EVENING_OFFER,
    };
  }

  if (dow === 0) {
    return {
      reason: "sunday",
      text:
        `ביום ראשון אנחנו פתוחים עד 18:00, ולכן אין בו הזמנות ערב - במהלך היום פשוט מגיעים, על בסיס מקום פנוי 🙂\n` +
        EVENING_OFFER,
    };
  }

  // שני-חמישי: הזמנות רק מ-18:00
  const hour = parseHour(t);
  if (hour !== null && hour >= 18) return null; // בקשה תקינה -> זרימת ההזמנה במודל
  if (hour === null) {
    // בלי שעה מפורשת אי אפשר לדעת אם הכוונה לערב - חוץ ממקרה אחד: "יש מקום
    // להיום?" כשעכשיו עוד יום. שם התשובה על שעות היום נכונה וגם משלימה את
    // התמונה (מה שכן אפשר בערב), אז היא בטוחה. כל שאר המקרים -> מודל.
    const nowHour = Number(
      new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", hour12: false }).format(now)
    );
    const isToday = iso === now.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
    if (!isToday || nowHour >= 18) return null;
  }

  const when = whenLabel(iso, now);
  // "היום בשעות היום" מגושם - לכן פתיח אחר כשמדובר בהיום עצמו
  const lead = when === "היום" ? "היום פשוט מגיעים בלי הזמנה" : `${when} בשעות היום מגיעים בלי הזמנה`;
  return {
    reason: "daytime",
    text:
      `${lead} - על בסיס מקום פנוי, ותמיד נשמח לארח 🙂\n` +
      `הזמנות מראש הן לשעות הערב, מ-18:00, בימים שני-חמישי - אם בא לכם, אפשר לשריין כאן בצ'אט.`,
  };
}
