/**
 * מדיניות הזמנת המקום - **מקור האמת היחיד**.
 *
 * למה הקובץ הזה קיים (18.9.2026): המדיניות הייתה מפוזרת בשישה מקומות - המנוע
 * הדטרמיניסטי, שני כללים בפרומפט, שתי תשובות חינמיות והבדיקות - וכל שינוי
 * חייב היה להיעשות בכולם. כשזה לא קרה, שתי מדיניות דיברו באותה הודעה: קבוצה
 * של 12 בשישי קיבלה גם "בשישי אין הזמנות מראש" וגם הפניה לברק.
 *
 * מעכשיו: הטבלה מוגדרת פעם אחת כאן, הפרומפט **נבנה ממנה**, המנוע קורא לה,
 * והבדיקות עוברות על כל המטריצה. שינוי מדיניות = שינוי בקובץ הזה בלבד.
 */

/** איש הקשר לקבוצות ואירועים */
export const BARAK_PHONE = "050-236-6466";
/** מהמספר הזה ומעלה מפנים לברק - בכל יום ובכל שעה */
export const GROUP_MIN_FOR_BARAK = 9;
/** הזמנות מראש רק מהשעה הזו */
export const BOOKING_FROM_HOUR = 18;
/** ובימים האלה בלבד (0=ראשון .. 6=שבת): שני עד חמישי */
export const BOOKING_DAYS = [1, 2, 3, 4];

export const HE_DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

/**
 * ההחלטה האפשרית על בקשת הזמנה:
 * book     - משבצת שאפשר לשריין בה; הזרימה עוברת לאיסוף פרטים (אין טקסט קבוע)
 * walk_in  - בסיס מקום פנוי
 * barak    - קבוצה גדולה, מפנים לברק
 * closed   - המסעדה סגורה באותו יום
 * closed_hour - היום פתוח, אבל **בשעה המבוקשת** סגורים (ראשון ב-20:00, אחרי
 *            ההושבה האחרונה, לפני הפתיחה). אין נוסח קבוע: המודל מנסח לפי
 *            שורת ההכרעה שהקוד מזריק לו (reservation-availability.ts)
 * ask_size - חסר מספר הסועדים, ובלעדיו אי אפשר לענות (9+ היו הולכים לברק)
 * defer    - אין מספיק מידע להכרעה בקוד; המודל ממשיך את השיחה
 */
export type ReservationVerdict = "book" | "walk_in" | "barak" | "closed" | "closed_hour" | "ask_size" | "defer";

/**
 * הנוסחים המדויקים ללקוח (נכתבו על ידי בעל העסק 18.9).
 * הדגשה בכוכבית **בודדת** - זה מה שוואטסאפ מרנדר כמודגש.
 * ⚠️ לעולם אל תעטוף מספר טלפון בכוכביות: *8149 מתחיל בכוכבית וזה נשבר.
 */
export const RESERVATION_TEXTS = {
  /** קבוצה גדולה (9+) - בכל יום ובכל שעה */
  barak:
    `לקבוצה בגודל כזה הכי נוח לתאם ישירות מול ברק, איש הקשר שלנו לקבוצות ואירועים: ${BARAK_PHONE}. ` +
    `תדברו איתו והוא ייתן לכם את כל הפרטים.🙂`,
  /** חסר מספר סועדים - שואלים לפני כל תשובה על זמינות */
  askSize: "בשמחה 🙂 כמה תהיו?",
  /** שישי - כל היום */
  friday:
    "בימי שישי אנחנו לא לוקחים הזמנות מראש - פשוט מגיעים ויושבים על בסיס מקום פנוי. אנחנו פתוחים עד 15:00🙂",
  /** ראשון - כל היום (נסגרים ב-18:00 ולכן אין בו ערב) */
  sunday: "ביום ראשון אנחנו לא לוקחים הזמנות מראש, פשוט מגיעים ויושבים על בסיס מקום פנוי🙂",
  /** שני-חמישי לפני 18:00 */
  daytime:
    "אנחנו לא לוקחים הזמנות מראש לשעות היום, פשוט מגיעים ויושבים על בסיס מקום פנוי.🙂\n" +
    "הזמנות מראש הן רק לשעות הערב (החל מ-18:00), אם תרצו אשמח לעזור לכם לשריין כאן בצ'אט.",
  /** שבת */
  saturday: "בשבת אנחנו סגורים, נשמח לפגוש אותכם ביום ראשון. 🙂",
  /** סגירה חריגה שהוזנה בפאנל (חג וכו') */
  closedOther: "בתאריך הזה אנחנו סגורים 🙂",
} as const;

export interface PolicyQuery {
  /** 0=ראשון .. 6=שבת */
  dayOfWeek: number;
  /** האם המסעדה פתוחה בכלל באותו תאריך (כולל דריסות מהפאנל) */
  openThatDay: boolean;
  /** השעה המבוקשת (0-23), או null כשאינה ידועה */
  hour: number | null;
  /** מספר הסועדים, או null כשאינו ידוע */
  people: number | null;
  /** הדקות בתוך השעה (20:30 -> 30). ברירת מחדל 0 */
  minute?: number;
  /**
   * שעות הפעילות באותו תאריך, בדקות מחצות (כולל דריסות מהפאנל). כשחסר - השעה
   * המבוקשת לא נבדקת מול שעות הפתיחה.
   */
  window?: OpenWindow | null;
}

/** שעות הפעילות של יום אחד, בדקות מחצות. סגירה ב-00:00 = 1440. */
export interface OpenWindow {
  open: number;
  close: number;
  /** ההושבה האחרונה, או null כשלא הוגדרה לאותו יום */
  lastSeating: number | null;
}

/**
 * האם השעה המבוקשת נופלת מחוץ לשעות הפעילות של אותו יום.
 * נולד מתקלה אמיתית (19.9): לקוח ביקש ראשון ב-20:00, והבוט ענה "פשוט מגיעים
 * על בסיס מקום פנוי" - אבל בראשון נסגרים ב-18:00. הטבלה אמרה "ראשון = מקום
 * פנוי" ואף אחד לא בדק את השעה.
 */
export function outsideOpenWindow(minuteOfDay: number, w: OpenWindow): boolean {
  if (minuteOfDay < w.open || minuteOfDay >= w.close) return true;
  return w.lastSeating !== null && minuteOfDay > w.lastSeating;
}

export interface PolicyDecision {
  verdict: ReservationVerdict;
  /** הנוסח המלא ללקוח, או null כשהתשובה נמסרת על ידי המודל */
  text: string | null;
}

/**
 * ההכרעה היחידה. סדר הבדיקות הוא המדיניות עצמה:
 *   1. סגור באותו יום - גובר על הכל, **גם על קבוצה גדולה** (החלטת בעל העסק:
 *      "בשבת סגורים תמיד, לא משנה כמה אנשים").
 *   2. סגור **בשעה המבוקשת** - מאותו היגיון בדיוק: סגור גובר על גודל.
 *   3. 9 סועדים ומעלה - ברק, בכל יום ובכל שעה שבה פתוחים.
 *   4. שני-חמישי מ-18:00 - שומרים כאן.
 *   5. כל השאר - בסיס מקום פנוי, **אבל רק אחרי שיודעים כמה הם**: בלי המספר
 *      אי אפשר לדעת אם התשובה הנכונה היא מקום-פנוי או ברק.
 */
export function decideReservation(q: PolicyQuery): PolicyDecision {
  if (!q.openThatDay) {
    return {
      verdict: "closed",
      text: q.dayOfWeek === 6 ? RESERVATION_TEXTS.saturday : RESERVATION_TEXTS.closedOther,
    };
  }
  if (q.hour !== null && q.window && outsideOpenWindow(q.hour * 60 + (q.minute ?? 0), q.window)) {
    return { verdict: "closed_hour", text: null };
  }
  if (q.people !== null && q.people >= GROUP_MIN_FOR_BARAK) {
    return { verdict: "barak", text: RESERVATION_TEXTS.barak };
  }
  if (BOOKING_DAYS.includes(q.dayOfWeek)) {
    if (q.hour === null) return { verdict: "defer", text: null }; // המודל יברר שעה וכמות
    if (q.hour >= BOOKING_FROM_HOUR) return { verdict: "book", text: null };
    if (q.people === null) return { verdict: "ask_size", text: RESERVATION_TEXTS.askSize };
    return { verdict: "walk_in", text: RESERVATION_TEXTS.daytime };
  }
  // ראשון ושישי: כל היום בסיס מקום פנוי (לגדלים 1-8)
  if (q.people === null) return { verdict: "ask_size", text: RESERVATION_TEXTS.askSize };
  return {
    verdict: "walk_in",
    text: q.dayOfWeek === 5 ? RESERVATION_TEXTS.friday : RESERVATION_TEXTS.sunday,
  };
}

/**
 * טבלת ההכרעה כטקסט לפרומפט - **נבנית מאותם קבועים** שהמנוע משתמש בהם,
 * כדי שההנחיה למודל לעולם לא תסטה מההתנהגות בפועל.
 */
export function reservationPolicyTable(): string {
  const small = `1-${GROUP_MIN_FOR_BARAK - 1} סועדים`;
  const big = `${GROUP_MIN_FOR_BARAK} ומעלה`;
  return [
    `     | מתי | ${small} | ${big} |`,
    `     |---|---|---|`,
    `     | **שני-חמישי, מ-${BOOKING_FROM_HOUR}:00** | ✅ שומרים כאן בצ'אט | ➡️ ברק |`,
    `     | **שני-חמישי, לפני ${BOOKING_FROM_HOUR}:00** | 🚶 מקום פנוי | ➡️ ברק |`,
    `     | **ראשון** (נסגרים ב-18:00) | 🚶 מקום פנוי | ➡️ ברק |`,
    `     | **שישי** (עד 15:00) | 🚶 מקום פנוי | ➡️ ברק |`,
    `     | **שבת** | 🔒 סגור | 🔒 סגור |`,
    ``,
    `     **הסף הוא ${GROUP_MIN_FOR_BARAK} בדיוק, ואין עיגול:** ${GROUP_MIN_FOR_BARAK - 1} סועדים הם עדיין העמודה השמאלית ` +
      `(**לא** ברק) - בכל יום, כולל שישי. רק ${GROUP_MIN_FOR_BARAK} ומעלה הולכים לברק.`,
  ].join("\n");
}
