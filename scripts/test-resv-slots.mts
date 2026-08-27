// בדיקת מחלץ פרטי ההזמנה - רץ עם tsx על המודול האמיתי:
//   npx tsx scripts/test-resv-slots.mts
import { extractReservationSlots } from "../src/lib/reservation-slots";

let fails = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} (got ${got}, want ${want})`);
};

const u = (content: string, ts?: number) => ({ role: "user", content, ts });

// --- אנשים: מילים, ספרות, והקשרים שאסור לבלבל עם שעה ---
check("נהיה שתיים", extractReservationSlots([u("נהיה שתיים, בפנים")]).people, 2);
check("ארבעה אנשים", extractReservationSlots([u("ארבעה אנשים")]).people, 4);
check("אנחנו חמישה", extractReservationSlots([u("אנחנו חמישה")]).people, 5);
check("נהיה 6", extractReservationSlots([u("נהיה 6")]).people, 6);
check("זוג", extractReservationSlots([u("זוג בבקשה")]).people, 2);
check("'נגיע בשמונה' זו שעה לא כמות", extractReservationSlots([u("נגיע בשמונה בערב")]).people, undefined);
check("'שמונה' לבד לא כמות", extractReservationSlots([u("שמונה")]).people, undefined);

// --- תרחיש כרם המלא: פרוסות ---
const karem = extractReservationSlots([
  u("אפשר להזמין שולחן?"),
  u("כאן בצ'אט. היום בערב בשעה 20:00"),
  u("נהיה שתיים, בפנים"),
  u("על שם כרם"),
  u("0524461628"),
]);
check("כרם: אנשים", karem.people, 2);
check("כרם: שעה", karem.time, "20:00");
check("כרם: ישיבה", karem.seating, "בפנים");
check("כרם: שם", karem.name, "כרם");
check("כרם: טלפון", karem.phone, "0524461628");
check("כרם: הכל נאסף", karem.missing.length, 0);

// --- עיגון תאריכים: "מחר" מלפני שבוע = לפי זמן ההודעה ---
const weekAgo = Date.now() - 7 * 24 * 3600_000;
const anchored = extractReservationSlots([u("מחר בערב", weekAgo)]);
const tomorrowOfWeekAgo = new Date(weekAgo + 24 * 3600_000).toLocaleDateString("en-CA", {
  timeZone: "Asia/Jerusalem",
});
check("'מחר' מעוגן לזמן ההודעה", anchored.dateISO, tomorrowOfWeekAgo);
const fresh = extractReservationSlots([u("מחר בערב")]);
const tomorrowNow = new Date(Date.now() + 24 * 3600_000).toLocaleDateString("en-CA", {
  timeZone: "Asia/Jerusalem",
});
check("'מחר' בלי ts = מחר של עכשיו", fresh.dateISO, tomorrowNow);

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURES`);
process.exit(fails ? 1 : 0);
