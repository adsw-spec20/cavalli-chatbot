import type { Reservation } from "./types";

/** תבניות ההודעה שנשלחות ללקוח על בקשת הזמנה - משותפות לעמוד ההזמנות
 *  ולכרטיס ההזמנה שבתוך שיחת התיבה (16.9). ניתנות לעריכה לפני שליחה.
 *  חשוב (הוחלט 20.8): "יש מקום" עדיין לא אישור סופי - ההזמנה מאושרת רק אחרי
 *  תשלום פיקדון 100 ש"ח בקישור הטאביט שהצוות שולח. אסור לנסח "אושרה". */

const WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

/** התאריך בתבנית: קנוני מ-dateISO ("יום חמישי 13.8") כשקיים, אחרת מילות הלקוח. */
export function templateDate(r: Reservation): string {
  if (r.dateISO && /^\d{4}-\d{2}-\d{2}$/.test(r.dateISO)) {
    const [y, m, d] = r.dateISO.split("-").map(Number);
    return `יום ${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d}.${m}`;
  }
  return r.dateText;
}
export function approveTemplate(r: Reservation): string {
  return `חדשות טובות - יש לנו מקום ל-${templateDate(r)} בשעה ${r.time} 🙂 ${r.people} אנשים, על שם ${r.name}. כדי להשלים את ההזמנה נשלח לך עוד רגע קישור לתשלום עם הפרטים - שם משלמים פיקדון של 100 ש"ח, וברגע שהוא שולם ההזמנה מאושרת סופית. מחכים לך בקפה קוואלי! 🥂`;
}
export function declineTemplate(r: Reservation): string {
  return `היי ${r.name} 🙏 בדקנו ולצערנו אין לנו מקום פנוי ל-${templateDate(r)} בשעה ${r.time}. אפשר לנסות שעה או יום אחרים, או לחייג *8149 או 050-979-8917 ונשמח לעזור למצוא פתרון.`;
}
export function cancelTemplate(r: Reservation): string {
  return `היי ${r.name} 🙏 ההזמנה שלך ל-${templateDate(r)} בשעה ${r.time} (${r.people} אנשים) בוטלה. אם מדובר בטעות או שתרצה לקבוע מחדש, אפשר לחייג *8149 או 050-979-8917 ונשמח לעזור.`;
}
