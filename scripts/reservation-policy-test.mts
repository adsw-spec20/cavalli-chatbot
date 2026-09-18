/**
 * בדיקות ממצות למדיניות ההזמנות (reservation-policy + המנוע הדטרמיניסטי).
 * הרצה: npx tsx scripts/reservation-policy-test.mts
 *
 * עוברות על **כל** המטריצה (יום × שעה × גודל קבוצה) ומשוות מול הטבלה שבעל
 * העסק אישר (18.9), כדי ששינוי עתידי לא ישבור תא בשקט.
 */
import { decideReservation, GROUP_MIN_FOR_BARAK, RESERVATION_TEXTS } from "../src/lib/reservation-policy";
import { checkReservationAvailability } from "../src/lib/reservation-availability";
import { businessConfig } from "../src/lib/business-config";

let pass = 0, fail = 0;
function t(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; }
  else { fail++; console.log(`❌ ${name}`, extra ?? ""); }
}

const DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const HOURS = [null, 9, 13, 17, 18, 20, 22];
const SIZES = [null, 1, 2, 4, 8, 9, 12, 20];

/** הטבלה שבעל העסק אישר, כפונקציה עצמאית - מימוש שני שמוודא את הראשון */
function expected(day: number, hour: number | null, people: number | null): string {
  const open = day !== 6; // שבת סגור (שאר הימים פתוחים בקונפיג)
  if (!open) return "closed";
  if (people !== null && people >= 9) return "barak";
  if (day >= 1 && day <= 4) {
    if (hour === null) return "defer";
    if (hour >= 18) return "book";
    return people === null ? "ask_size" : "walk_in";
  }
  return people === null ? "ask_size" : "walk_in";
}

// ===== 1. כל המטריצה =====
let combos = 0;
for (let day = 0; day <= 6; day++) {
  for (const hour of HOURS) {
    for (const people of SIZES) {
      combos++;
      const got = decideReservation({ dayOfWeek: day, openThatDay: day !== 6, hour, people }).verdict;
      const want = expected(day, hour, people);
      t(`${DAYS[day]} ${hour ?? "?"}:00 ${people ?? "?"} סועדים`, got === want, `got=${got} want=${want}`);
    }
  }
}
console.log(`✅ מטריצה מלאה: ${combos} צירופים`);

// ===== 2. תאים ספציפיים מהטבלה של בעל העסק =====
const cell = (day: number, hour: number | null, people: number | null) =>
  decideReservation({ dayOfWeek: day, openThatDay: day !== 6, hour, people });

t("ב-ה 20:00, 4 סועדים = שומרים", cell(2, 20, 4).verdict === "book");
t("ב-ה 20:00, 8 סועדים = שומרים", cell(2, 20, 8).verdict === "book");
t("ב-ה 20:00, 9 סועדים = ברק", cell(2, 20, 9).verdict === "barak");
t("ב-ה 13:00, 4 סועדים = מקום פנוי", cell(2, 13, 4).verdict === "walk_in");
t("ב-ה 13:00, 8 סועדים = מקום פנוי", cell(2, 13, 8).verdict === "walk_in");
t("ב-ה 13:00, 9 סועדים = ברק", cell(2, 13, 9).verdict === "barak");
t("ראשון 12:00, 8 סועדים = מקום פנוי", cell(0, 12, 8).verdict === "walk_in");
t("ראשון 20:00, 4 סועדים = מקום פנוי (אין ערב בראשון)", cell(0, 20, 4).verdict === "walk_in");
t("ראשון, 9 סועדים = ברק", cell(0, 12, 9).verdict === "barak");
t("שישי 11:00, 4 סועדים = מקום פנוי", cell(5, 11, 4).verdict === "walk_in");
t("שישי 11:00, 8 סועדים = מקום פנוי (התיקון של 18.9)", cell(5, 11, 8).verdict === "walk_in");
t("שישי 11:00, 9 סועדים = ברק", cell(5, 11, 9).verdict === "barak");
t("שבת, 4 סועדים = סגור", cell(6, 13, 4).verdict === "closed");
t("שבת, 20 סועדים = סגור (סגור גובר על קבוצה)", cell(6, 13, 20).verdict === "closed");

// ===== 3. שער הכמות: בלי מספר סועדים לא עונים תשובת זמינות =====
t("שישי בלי כמות = שואלים כמה", cell(5, 11, null).verdict === "ask_size");
t("ראשון בלי כמות = שואלים כמה", cell(0, 13, null).verdict === "ask_size");
t("ב-ה שעות היום בלי כמות = שואלים כמה", cell(2, 13, null).verdict === "ask_size");
t("שבת בלי כמות = סגור (הגודל לא משנה)", cell(6, 13, null).verdict === "closed");
t("ב-ה ערב בלי כמות = שומרים (המודל אוסף)", cell(2, 20, null).verdict === "book");
t("ב-ה בלי שעה ובלי כמות = המודל ממשיך", cell(2, null, null).verdict === "defer");

// ===== 4. הנוסחים - בדיוק מה שבעל העסק אישר =====
t("נוסח שישי", cell(5, 11, 4).text === RESERVATION_TEXTS.friday);
t("נוסח ראשון", cell(0, 13, 4).text === RESERVATION_TEXTS.sunday);
t("נוסח שעות היום", cell(2, 13, 4).text === RESERVATION_TEXTS.daytime);
t("נוסח שבת", cell(6, 13, 4).text === RESERVATION_TEXTS.saturday);
t("נוסח ברק", cell(2, 20, 12).text === RESERVATION_TEXTS.barak);
t("ברק בלי כוכביות סביב הטלפון", !/\*050/.test(RESERVATION_TEXTS.barak));
t("אין כוכבית כפולה באף נוסח", !Object.values(RESERVATION_TEXTS).some((s) => s.includes("**")));
t("הסף הוא 9", GROUP_MIN_FOR_BARAK === 9);

// ===== 5. המנוע מקצה לקצה (טקסט חופשי -> תשובה) =====
// תאריכים קבועים כדי שהבדיקה לא תשתנה לפי יום ההרצה
const friday = new Date("2026-09-18T09:00:00+03:00");   // שישי
const tuesday = new Date("2026-09-22T09:00:00+03:00");  // שלישי
const e = (msg: string, now: Date) => checkReservationAvailability(msg, businessConfig, now);

t("מנוע: שישי בלי כמות -> שואל כמה",
  e("אני רוצה להזמין מקום ליום שישי", friday)?.reason === "ask_size");
t("מנוע: שישי 4 אנשים -> מקום פנוי",
  e("אפשר להזמין מקום ליום שישי ל-4 אנשים", friday)?.reason === "friday");
t("מנוע: שישי 8 אנשים -> מקום פנוי",
  e("אפשר להזמין מקום ליום שישי ל-8 אנשים", friday)?.reason === "friday");
t("מנוע: שישי 9 אנשים -> ברק",
  e("אפשר להזמין מקום ליום שישי ל-9 אנשים", friday)?.reason === "group");
t("מנוע: שישי 12 אנשים -> ברק בלבד, בלי כלל שישי",
  e("אפשר להזמין מקום ליום שישי ל-12 אנשים", friday)?.text === RESERVATION_TEXTS.barak);
t("מנוע: שבת 20 אנשים -> סגור",
  e("אפשר להזמין שולחן לשבת ל-20 אנשים", friday)?.reason === "saturday");
t("מנוע: קבוצה בלי יום -> ברק",
  e("אפשר להזמין מקום ל-15 אנשים", tuesday)?.reason === "group");
t("מנוע: ערב שלישי תקין -> ממשיך למודל",
  e("יש מקום ביום שלישי ב-20:00 ל-4?", tuesday) === null);
t("מנוע: הודעה לא קשורה -> null", e("מה שעות הפעילות?", tuesday) === null);

console.log(`\n${fail === 0 ? "🎉" : "⚠"} ${pass} עברו, ${fail} נכשלו`);
process.exit(fail === 0 ? 0 : 1);
