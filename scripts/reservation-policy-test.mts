/**
 * בדיקות ממצות למדיניות ההזמנות (reservation-policy + המנוע הדטרמיניסטי).
 * הרצה: npx tsx scripts/reservation-policy-test.mts
 *
 * עוברות על **כל** המטריצה (יום × שעה × גודל קבוצה) ומשוות מול הטבלה שבעל
 * העסק אישר (18.9), כדי ששינוי עתידי לא ישבור תא בשקט.
 */
import { decideReservation, GROUP_MIN_FOR_BARAK, RESERVATION_TEXTS } from "../src/lib/reservation-policy";
import {
  checkReservationAvailability,
  closedDayText,
  saturdayClosedText,
  policyVerdictFor,
  openWindowFor,
  hasReservationIntent,
} from "../src/lib/reservation-availability";
import { businessConfig } from "../src/lib/business-config";
import { resolveReservationDate } from "../src/lib/reservations";
import { extractReservationSlots, reservationSlotsHint } from "../src/lib/reservation-slots";

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

// ===== 6. "שבוע הבא" + שם יום (דווח 18.9: "שישי" נפתר להיום ולא לשבוע הבא) =====
const friNow = new Date("2026-09-18T17:07:00+03:00"); // יום שישי
t("'שישי' בלי הקשר ביום שישי = היום", resolveReservationDate("שישי", undefined, friNow) === "2026-09-18");
t("'שישי' אחרי 'שבוע הבא' = 25.9", resolveReservationDate("שישי", undefined, friNow, { nextWeek: true }) === "2026-09-25");
t("'שלישי' אחרי 'שבוע הבא' = 22.9 (כבר בשבוע הבא)", resolveReservationDate("שלישי", undefined, friNow, { nextWeek: true }) === "2026-09-22");
t("'שבוע הבא ביום שישי' באותה הודעה = 25.9", resolveReservationDate("שבוע הבא ביום שישי", undefined, friNow) === "2026-09-25");
t("'בעוד שבועיים' נשאר לא מוכרע", resolveReservationDate("בעוד שבועיים", undefined, friNow) === undefined);
{
  const slots = extractReservationSlots([
    { role: "user", content: "אני רוצה להזמין מקום לשבוע הבא", ts: friNow.getTime() },
    { role: "assistant", content: "לאיזה יום בשבוע הבא?", ts: friNow.getTime() },
    { role: "user", content: "שישי", ts: friNow.getTime() },
  ]);
  t("השיחה שדווחה: 'שבוע הבא' -> 'שישי' = 25.9", slots.dateISO === "2026-09-25", slots.dateISO);
}

// ===== 7. תאריך מספרי לא נקרא ככמות סועדים (דווח 18.9: "7.9 אנשים" -> 9 -> ברק) =====
{
  const sep7 = new Date("2026-09-01T12:00:00+03:00"); // שלישי, לפני 7.9
  t("'ל-7.9 אנשים' לא מופנה לברק", e("אפשר להזמין מקום ל-7.9 אנשים", sep7)?.reason !== "group",
    e("אפשר להזמין מקום ל-7.9 אנשים", sep7)?.reason);
  t("'7.9' עדיין נקרא כתאריך", resolveReservationDate("אפשר מקום ל-7.9", undefined, sep7) === "2026-09-07");
  const slots = extractReservationSlots([
    { role: "user", content: "אפשר להזמין מקום ל-7.9 אנשים", ts: sep7.getTime() },
  ]);
  t("חילוץ: '7.9 אנשים' לא מייצר כמות סועדים", slots.people === undefined, slots.people);
  // ומספר אמיתי כן נקלט
  t("'12 אנשים' עדיין נקלט", e("אפשר להזמין מקום ל-12 אנשים", sep7)?.reason === "group");
  t("'4 אנשים' עדיין נקלט", extractReservationSlots([
    { role: "user", content: "נהיה 4 אנשים", ts: sep7.getTime() },
  ]).people === 4);
}

// ===== 8. שעה מחוץ לשעות הפעילות (דווח 19.9: "ראשון ב-20:00" -> "פשוט מגיעים") =====
// אותה מטריצה, הפעם עם שעות הפעילות האמיתיות של כל יום. ראשון נסגר ב-18:00,
// שישי ב-15:00, שני-חמישי פתוחים 08:00-00:00 עם הושבה אחרונה ב-23:00.
{
  const CLOSE = [18, 24, 24, 24, 24, 15, 0]; // שעת סגירה לפי יום (שבת סגור ממילא)
  const withHours = (day: number, hour: number | null, people: number | null): string => {
    if (day === 6) return "closed";
    if (hour !== null && (hour < 8 || hour >= CLOSE[day])) return "closed_hour";
    return expected(day, hour, people);
  };
  const windowOf = (day: number) =>
    openWindowFor(businessConfig, ["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"][day]);
  let n = 0;
  for (let day = 0; day <= 6; day++) {
    for (const hour of [...HOURS, 7, 23]) {
      for (const people of SIZES) {
        n++;
        const got = decideReservation({ dayOfWeek: day, openThatDay: day !== 6, hour, people, window: windowOf(day) }).verdict;
        const want = withHours(day, hour, people);
        t(`עם שעות: ${DAYS[day]} ${hour ?? "?"}:00 ${people ?? "?"}`, got === want, `got=${got} want=${want}`);
      }
    }
  }
  console.log(`✅ מטריצה עם שעות פעילות: ${n} צירופים`);

  const w = windowOf(3); // רביעי
  t("רביעי 23:00 = עוד בזמן (הושבה אחרונה)", decideReservation({ dayOfWeek: 3, openThatDay: true, hour: 23, minute: 0, people: 2, window: w }).verdict === "book");
  t("רביעי 23:30 = אחרי ההושבה האחרונה", decideReservation({ dayOfWeek: 3, openThatDay: true, hour: 23, minute: 30, people: 2, window: w }).verdict === "closed_hour");
  t("ראשון 17:30 = עוד פתוחים (מקום פנוי)", decideReservation({ dayOfWeek: 0, openThatDay: true, hour: 17, minute: 30, people: 2, window: windowOf(0) }).verdict === "walk_in");
  t("ראשון 20:00 ל-12 = סגור (סגור גובר על גודל)", decideReservation({ dayOfWeek: 0, openThatDay: true, hour: 20, people: 12, window: windowOf(0) }).verdict === "closed_hour");
}

// ===== 9. השיחה שדווחה 19.9, מקצה לקצה =====
// מוצאי שבת 19.9. מחר (ראשון 20.9) ערב יום כיפור, שני 21.9 יום כיפור - סגור.
{
  const cfgYK = {
    ...businessConfig,
    hoursOverrides: [
      { date: "2026-09-20", hours: null, note: "ערב יום כיפור" },
      { date: "2026-09-21", hours: null, note: "סגור - יום כיפור" },
    ],
  };
  const T = (hhmmss: string) => new Date(`2026-09-19T${hhmmss}+03:00`);

  // הודעה 1 - התשובה הקבועה חייבת לומר איזה יום, למה, ומתי נפתחים
  const a1 = checkReservationAvailability("אני רוצה לשמור שולחן למחר ל2 אנשים", cfgYK, T("21:16:53"));
  t("סגירת חג: עונים בקוד", a1?.reason === "closed", a1);
  t("סגירת חג: היום והתאריך", !!a1?.text.includes("מחר, יום ראשון 20.9,"), a1?.text);
  t("סגירת חג: הסיבה", !!a1?.text.includes("(ערב יום כיפור)"), a1?.text);
  t("סגירת חג: מתי נפתחים (מדלג על יום כיפור)", !!a1?.text.includes("נפתח שוב ביום שלישי 22.9"), a1?.text);
  t("סגירת חג: לא 'בתאריך הזה' סתם", !a1?.text.includes("בתאריך הזה"), a1?.text);
  const kip = closedDayText(cfgYK, "2026-09-21", T("21:16:53"));
  t("'סגור - יום כיפור' בפאנל לא יוצא 'סגורים (סגור - ...)'", kip.includes("(יום כיפור)") && !kip.includes("(סגור"), kip);

  // נוסח השבת מזמין "ביום ראשון" - אבל השבוע ראשון סגור
  t("שבת כשראשון סגור: מזמינים ליום הפתוח הבא",
    saturdayClosedText(cfgYK, "2026-09-19", T("12:00:00")).includes("ביום שלישי 22.9"),
    saturdayClosedText(cfgYK, "2026-09-19", T("12:00:00")));
  t("שבת רגילה: הנוסח של בעל העסק מילה במילה",
    saturdayClosedText(cfgYK, "2026-09-26", T("12:00:00")) === RESERVATION_TEXTS.saturday);

  // "יום ראשון הבא" אחרי שנאמר לו שמחר (ראשון) סגור
  t("'אז ליום ראשון הבא ב20:00' במוצ\"ש = 27.9, לא מחר",
    resolveReservationDate("אז ליום ראשון הבא ב20:00", undefined, T("21:17:21")) === "2026-09-27",
    resolveReservationDate("אז ליום ראשון הבא ב20:00", undefined, T("21:17:21")));
  t("'יום חמישי הבא' במוצ\"ש = 24.9 (הקרוב)", resolveReservationDate("ליום חמישי הבא", undefined, T("21:19:04")) === "2026-09-24");
  t("'ראשון הקרוב' במוצ\"ש = מחר", resolveReservationDate("ראשון הקרוב", undefined, T("21:17:21")) === "2026-09-20");
  const wed = new Date("2026-09-16T12:00:00+03:00");
  t("'חמישי הבא' ביום רביעי = השבוע שאחרי (על מחר אומרים 'מחר')", resolveReservationDate("חמישי הבא", undefined, wed) === "2026-09-24");
  t("'ראשון הבא' ביום רביעי = הקרוב", resolveReservationDate("ראשון הבא", undefined, wed) === "2026-09-20");

  // "שני" כמספר ולא כיום
  t("'שולחן לשני אנשים' אינו יום שני", resolveReservationDate("שולחן לשני אנשים", undefined, wed) === undefined);
  t("'אנחנו שני זוגות' אינו יום שני", resolveReservationDate("אנחנו שני זוגות", undefined, wed) === undefined);
  t("'ביום שני' עדיין יום שני", resolveReservationDate("ביום שני", undefined, wed) === "2026-09-21");
  t("'לשני בערב' עדיין יום שני", resolveReservationDate("לשני בערב", undefined, wed) === "2026-09-21");
  t("'שני אנשים ביום רביעי' = רביעי", resolveReservationDate("שני אנשים ביום רביעי", undefined, wed) === "2026-09-16");
  t("'בראשון לציון' אינו יום ראשון", resolveReservationDate("אנחנו גרים בראשון לציון", undefined, wed) === undefined);

  // ראשון 27.9 ב-20:00 - המנוע לא עונה "מקום פנוי", וההכרעה למודל היא "סגור בשעה הזו"
  t("מנוע: 'להזמין לראשון ב-20:00' לא מקבל את נוסח ראשון",
    checkReservationAvailability("אפשר להזמין שולחן ליום ראשון ב-20:00 ל-2 אנשים", cfgYK, T("21:17:21"))?.reason !== "sunday");
  t("מנוע: 'יש מקום בראשון בערב?' לא מקבל את נוסח ראשון",
    checkReservationAvailability("יש מקום ביום ראשון בערב ל-4?", cfgYK, new Date("2026-09-23T12:00:00+03:00"))?.reason !== "sunday");
  const v = policyVerdictFor(cfgYK, { dateISO: "2026-09-27", time: "20:00", people: 2 }, T("21:17:51"));
  t("הכרעה: ראשון 27.9 ב-20:00 = סגור בשעה הזו", v?.verdict === "closed_hour", v);
  t("הכרעה: אומרת את שעות אותו יום", !!v?.line?.includes("08:00-18:00"), v?.line);
  t("הכרעה: אוסרת 'מגיעים על בסיס מקום פנוי'", !!v?.line?.includes("אסור לומר לגביה"), v?.line);
  t("הכרעה: ראשון 27.9 ב-12:00 ל-2 = מקום פנוי",
    policyVerdictFor(cfgYK, { dateISO: "2026-09-27", time: "12:00", people: 2 }, T("21:17:51"))?.verdict === "walk_in");
  const v20 = policyVerdictFor(cfgYK, { dateISO: "2026-09-20", time: "20:00", people: 2 }, T("21:17:04"));
  t("הכרעה: 20.9 = סגור כל היום, עם הסיבה ומתי נפתחים",
    v20?.verdict === "closed" && !!v20.line?.includes("ערב יום כיפור") && !!v20.line?.includes("22.9"), v20?.line);
  t("הכרעה: יום כיפור בשני = סגור גם אם 'שני ערב'",
    policyVerdictFor(cfgYK, { dateISO: "2026-09-21", time: "20:00", people: 2 }, T("21:17:04"))?.verdict === "closed");

  t("כוונת הזמנה: 'יש מקום הערב?'", hasReservationIntent("יש מקום הערב?"));
  t("לא כוונת הזמנה: 'יש מקום לחנות?'", !hasReservationIntent("יש מקום לחנות?"));

  // שולחנות
  t("'30 שולחנות של 2 אנשים' = 60, ברק",
    checkReservationAvailability("אני רוצה לשריין 30 שולחנות של 2 אנשים ליום חמישי הבא", cfgYK, T("21:19:04"))?.reason === "group");
  t("'4 שולחנות של 2 אנשים' = 8 (לא 2)",
    extractReservationSlots([{ role: "user", content: "4 שולחנות של 2 אנשים?", ts: T("21:19:48").getTime() }]).people === 8);

  // כל השיחה: השעה של ראשון לא עוברת לחמישי
  const convo = [
    ["user", "אני רוצה לשמור שולחן למחר ל2 אנשים", "21:16:53"],
    ["assistant", "מחר, יום ראשון 20.9, אנחנו סגורים (ערב יום כיפור) 🙂", "21:16:53"],
    ["user", "איזה תאריך?", "21:16:59"],
    ["assistant", "מחר, יום ראשון 20.9, אנחנו סגורים", "21:17:04"],
    ["user", "אז ליום ראשון הבא ב20:00", "21:17:21"],
    ["assistant", "...", "21:17:26"],
    ["user", "אמרתי לך יום ראשון הבא", "21:17:46"],
    ["assistant", "...", "21:17:51"],
    ["user", "אז פשוט לבוא ב20:00 בערב בלי לשמור מקום?", "21:18:07"],
    ["assistant", "...", "21:18:12"],
    ["user", "מה הגובה של שער הניצחון בפריז?", "21:18:36"],
    ["assistant", "...", "21:18:41"],
    ["user", "אני רוצה לשריין 30 שולחנות של 2 אנשים ליום חמישי הבא", "21:19:04"],
    ["assistant", "...", "21:19:09"],
    ["user", "4 שולחנות של 2 אנשים?", "21:19:48"],
    ["assistant", "...", "21:19:51"],
    ["user", "אמרתי לך כבר לאיזה יום", "21:20:03"],
  ].map(([role, content, hhmmss]) => ({ role, content, ts: T(hhmmss).getTime() }));

  const at = (k: number) => extractReservationSlots(convo.slice(0, k));
  t("אחרי 'ראשון הבא ב20:00': ראשון 27.9 ב-20:00", at(5).dateISO === "2026-09-27" && at(5).time === "20:00", at(5));
  const end = at(convo.length);
  t("סוף השיחה: 8 אנשים", end.people === 8, end.people);
  t("סוף השיחה: חמישי 24.9", end.dateISO === "2026-09-24", end.dateISO);
  t("סוף השיחה: שעה לא ידועה לחמישי", end.time === undefined, end.time);
  t("סוף השיחה: 20:00 נשמר כשעה של ראשון", end.priorTime?.time === "20:00" && end.priorTime?.dateISO === "2026-09-27", end.priorTime);
  const hint = reservationSlotsHint(end, { verdict: policyVerdictFor(cfgYK, end, T("21:20:03")) }) ?? "";
  t("רמז: לא מציג 'בשעה 20:00' כידוע", !hint.includes("· בשעה 20:00") && !hint.includes(": בשעה 20:00"), hint);
  t("רמז: מציע לשאול 'גם ב-20:00?'", hint.includes('"גם ב-20:00?"'), hint);
  t("רמז: שעה ברשימת החסרים", /עוד חסר: [^.]*שעה/.test(hint), hint);

  // סגור -> שער הכמות לא חוסם את התשובה היחידה הנכונה (רביעי 23.9 -> ראשון 27.9)
  const wed23 = new Date("2026-09-23T12:00:00+03:00");
  const noSize = extractReservationSlots([{ role: "user", content: "יש מקום ביום ראשון ב-20:00?", ts: wed23.getTime() }]);
  const noSizeHint = reservationSlotsHint(noSize, { verdict: policyVerdictFor(cfgYK, noSize, wed23) }) ?? "";
  t("סגור בשעה הזו בלי כמות: אין שער כמות", !noSizeHint.includes("מספר הסועדים עוד לא נאמר"), noSizeHint);
  t("סגור בשעה הזו בלי כמות: יש הכרעה", noSizeHint.includes("בשעה הזו אנחנו סגורים"), noSizeHint);
  const openNoSize = extractReservationSlots([{ role: "user", content: "יש מקום ביום ראשון ב-12:00?", ts: wed23.getTime() }]);
  t("פתוח בלי כמות: שער הכמות עדיין קיים",
    (reservationSlotsHint(openNoSize, { verdict: policyVerdictFor(cfgYK, openNoSize, wed23) }) ?? "").includes("מספר הסועדים עוד לא נאמר"));
}

console.log(`\n${fail === 0 ? "🎉" : "⚠"} ${pass} עברו, ${fail} נכשלו`);
process.exit(fail === 0 ? 0 : 1);
