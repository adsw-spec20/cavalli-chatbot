/**
 * בדיקות לפענוח מילות הזמן (src/lib/day-context.ts).
 *
 * הכל כאן טהור ולכן נבדק עם חותמות זמן קבועות: אין קריאה לשעון, אין קריאה
 * למודל, אין גישה למסד. הרצה: npx tsx scripts/day-context-test.mts  (חינם)
 *
 * הזמנים בנויים סביב התקרית האמיתית של 16-17.9.2026:
 *   רביעי 16.9 23:30 - הלקוח כתב "מקום למחר בערב" (התכוון לחמישי 17.9)
 *   חמישי 17.9 00:05 - הבוט ענה, וקרא "מחר" כשישי 18.9
 */
import {
  israelPartsAt,
  addDaysISO,
  formatDayHe,
  inMidnightWindow,
  relativeWordsIn,
  hasExplicitDate,
  tenseOf,
  dayHintForMessage,
  labDayHint,
  hasDayReference,
} from "../src/lib/day-context";

let pass = 0;
const fails: string[] = [];
const t = (name: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else fails.push(`${name}\n     קיבלנו:  ${JSON.stringify(got)}\n     ציפינו:  ${JSON.stringify(want)}`);
};
/** רגע בשעון ישראל (קיץ, UTC+3) */
const il = (iso: string, hhmm: string) => new Date(`${iso}T${hhmm}:00+03:00`).getTime();

const WED_2330 = il("2026-09-16", "23:30"); // רביעי בלילה
const THU_0005 = il("2026-09-17", "00:05"); // חמישי, חמש דקות אחרי חצות
const THU_0004 = il("2026-09-17", "00:04");
const THU_1400 = il("2026-09-17", "14:00");
const THU_0459 = il("2026-09-17", "04:59");
const THU_0501 = il("2026-09-17", "05:01");

// ===== יסודות =====
t("שעון ישראל - תאריך", israelPartsAt(WED_2330).dateISO, "2026-09-16");
t("שעון ישראל - שעה", israelPartsAt(WED_2330).hhmm, "23:30");
t("חצות חוצה יום", israelPartsAt(THU_0005).dateISO, "2026-09-17");
t("הוספת יום", addDaysISO("2026-09-16", 1), "2026-09-17");
t("הוספת יום חוצה חודש", addDaysISO("2026-09-30", 1), "2026-10-01");
t("הורדת יום חוצה חודש", addDaysISO("2026-10-01", -1), "2026-09-30");
t("שם יום", formatDayHe("2026-09-17"), "יום חמישי 17.9");

// ===== חלון אחרי חצות =====
t("00:05 בחלון", inMidnightWindow(THU_0005), true);
t("04:59 בחלון", inMidnightWindow(THU_0459), true);
t("05:01 מחוץ לחלון", inMidnightWindow(THU_0501), false);
t("23:30 מחוץ לחלון", inMidnightWindow(WED_2330), false);

// ===== זיהוי מילות זמן =====
const w = (s: string) => relativeWordsIn(s).map((x) => x.word);
t("מחר", w("רוצה מקום מחר בערב"), ["מחר"]);
t("מחרתיים לא נקראת כמחר", w("אפשר מחרתיים?"), ["מחרתיים"]);
t("היום", w("אתם פתוחים היום?"), ["היום"]);
t("הערב", w("יש מקום הערב?"), ["הערב"]);
t("בשעות הערב זה לא תאריך", w("הזמנות מתקבלות לשעות הערב"), []);
t("בשעות הלילה זה לא תאריך", w("סגורים בשעות הלילה"), []);
t("היומי אינו היום", w("התפריט היומי"), []);
t("בלי מילת זמן", w("מה המחיר של הפיצה?"), []);
t("אתמול", w("הייתי אצלכם אתמול"), ["אתמול"]);
// אותיות שימוש מחוברות - הניסוח הנפוץ ביותר, ובאג אמיתי שנתפס כאן
t("למחר", w("רוצה שולחן למחר"), ["מחר"]);
t("ומחר", w("היום ומחר"), ["מחר", "היום"]);
t("שמחר", w("אמרתי שמחר בערב"), ["מחר"]);
t("מהיום", w("מהיום בבוקר"), ["היום"]);
t("למחרתיים", w("אפשר למחרתיים"), ["מחרתיים"]);
t("בערב אינו הערב", w("מקום בערב"), []);
// לשון: מילים שמכילות 'יש' כתת-מחרוזת אסור שייחשבו לשון הווה
t("שישי אינו 'יש'", tenseOf("מה קורה בשישי"), "unknown");
t("ישיבה אינה 'יש'", tenseOf("ישיבה בפנים"), "unknown");
t("מגיש אינו 'יש'", tenseOf("מה מגישים"), "unknown");
t("ויש כן נחשב", tenseOf("ויש עוד מקום?"), "future");
t("שהיו כן נחשב", tenseOf("כמה שהיו אצלנו"), "past");

// ===== תאריך מפורש =====
t("17.9 הוא תאריך", hasExplicitDate("מחר 17.9"), true);
t("17/9 הוא תאריך", hasExplicitDate("ל-17/9"), true);
t("21.30 היא שעה ולא תאריך", hasExplicitDate("מחר ב-21.30"), false);
t("21:30 אינה תאריך", hasExplicitDate("מחר ב-21:30"), false);
t("יום חמישי מפורש", hasExplicitDate("מחר יום חמישי"), true);
t("ליום שישי מפורש", hasExplicitDate("אפשר ליום שישי?"), true);
t("שני אנשים אינו יום שני", hasExplicitDate("מחר לשני אנשים"), false);
t("טלפון אינו תאריך", hasExplicitDate("הטלפון 052-848-7546"), false);
t("שעה עגולה אינה תאריך", hasExplicitDate("מחר ב-9"), false);
t("שבת מפורש", hasExplicitDate("אתם פתוחים בשבת?"), true);

// ===== לשון =====
t("עבר", tenseOf("כמה אנשים היה היום במסעדה?"), "past");
t("עבר - היו", tenseOf("כמה הזמנות היו היום?"), "past");
t("עתיד", tenseOf("כמה הזמנות יש היום?"), "future");
t("עתיד - מגיעים", tenseOf("כמה אנשים מגיעים הערב?"), "future");
t("מעורב = לא ידוע", tenseOf("כמה היו וכמה יש היום?"), "unknown");
t("בלי סימן", tenseOf("היום"), "unknown");

// ===== בוט הלקוחות =====
// התקרית עצמה: נכתב ב-23:30 רביעי, נענה ב-00:05 חמישי -> חמישי, לא שישי
const late = dayHintForMessage("רוצה שולחן למחר בערב בתשע וחצי", WED_2330, THU_0005);
t("עוגן זמן כתיבה - לא שואל", late?.needsConfirm, false);
t("עוגן זמן כתיבה - חמישי ולא שישי", late?.line.includes("יום חמישי 17.9"), true);
t("עוגן זמן כתיבה - לא שישי", late?.line.includes("שישי"), false);
t("עוגן זמן כתיבה - מציין את זמן הכתיבה", late?.line.includes("23:30"), true);

// אותה הודעה, נענית מיד: בלי הערת "נכתבה לפני X דקות"
const prompt = dayHintForMessage("רוצה שולחן למחר בערב", WED_2330, WED_2330 + 60_000);
t("תשובה מיידית - בלי הערת זמן כתיבה", prompt?.line.includes("נכתבה"), false);
t("תשובה מיידית - עדיין פותר", prompt?.line.includes("יום חמישי 17.9"), true);

// נכתב אחרי חצות: שואלים
const amb = dayHintForMessage("רוצה מקום מחר בערב", THU_0004, THU_0004);
t("אחרי חצות - שואל", amb?.needsConfirm, true);
t("אחרי חצות - מציע חמישי", amb?.line.includes("יום חמישי 17.9"), true);
t("אחרי חצות - מציע שישי", amb?.line.includes("יום שישי 18.9"), true);

t(
  "אחרי חצות עם תאריך מפורש - לא שואל",
  dayHintForMessage("רוצה מקום מחר 18.9", THU_0004, THU_0004)?.needsConfirm,
  false
);
t(
  "אחרי חצות עם יום מפורש - לא שואל",
  dayHintForMessage("רוצה מקום מחר יום שישי", THU_0004, THU_0004)?.needsConfirm,
  false
);
t(
  "אחרי חצות - היום אינה מסוכנת",
  dayHintForMessage("אתם פתוחים היום?", THU_0004, THU_0004)?.needsConfirm,
  false
);
t(
  "אחרי חצות - אחרי ששאלנו פעם אחת לא שואלים שוב",
  dayHintForMessage("מחר", THU_0004, THU_0004, true)?.needsConfirm,
  false
);
t("ביום רגיל - לא שואל", dayHintForMessage("מחר בערב", THU_1400, THU_1400)?.needsConfirm, false);
t("בלי מילת זמן - אין הזרקה", dayHintForMessage("מה המחיר?", THU_1400, THU_1400), null);

// ===== המעבדה =====
const labPast = labDayHint("כמה אנשים היה היום במסעדה?", THU_0005);
t("מעבדה - לשון עבר לא שואלת", labPast?.needsConfirm, false);
t("מעבדה - לשון עבר = היום שהסתיים", labPast?.line.includes("יום רביעי 16.9"), true);
t("מעבדה - לשון עבר מורה לציין את היום", labPast?.line.includes("ציין"), true);

const labFuture = labDayHint("כמה הזמנות יש היום?", THU_0005);
t("מעבדה - לשון הווה = היום הקלנדרי", labFuture?.line.includes("יום חמישי 17.9"), true);
t("מעבדה - לשון הווה לא שואלת", labFuture?.needsConfirm, false);

const labTomorrow = labDayHint("כמה שולחנות יש למחר מהשעה 17:00", THU_0004);
t("מעבדה - מחר אחרי חצות שואלת", labTomorrow?.needsConfirm, true);
t("מעבדה - מציעה חמישי", labTomorrow?.line.includes("יום חמישי 17.9"), true);
t("מעבדה - מציעה שישי", labTomorrow?.line.includes("יום שישי 18.9"), true);
t(
  "מעבדה - אחרי ששאלנו, פותרת ומצהירה",
  labDayHint("למחר", THU_0004, true)?.needsConfirm,
  false
);
t("מעבדה - ביום רגיל אין הזרקה", labDayHint("כמה יש היום?", THU_1400), null);
t("מעבדה - תאריך מפורש אין הזרקה", labDayHint("כמה היה ב-16.9?", THU_0005), null);
t("מעבדה - בלי מילת זמן אין הזרקה", labDayHint("כמה שולחנות פנויים?", THU_0005), null);

// ===== יום בשבוע מזיז את העוגן (דווח 19.9) =====
// הלקוח כתב "מחר" (ראשון 20.9, סגור) ואז "אז ליום ראשון הבא". העוגן חיפש רק
// מילים יחסיות ותאריכים מספריים, ולכן המשיך לומר למודל "מחר = ראשון 20.9".
const SAT_2117 = il("2026-09-19", "21:17");
t("יום בשבוע נחשב הפניה ליום", hasDayReference("אז ליום ראשון הבא ב20:00", "2026-09-19"), true);
t("'שני אנשים' אינו הפניה ליום", hasDayReference("אנחנו שני אנשים", "2026-09-19"), false);
t("בלי יום - אין הפניה", hasDayReference("אז פשוט לבוא בלי לשמור מקום?", "2026-09-19"), false);
const nextSun = dayHintForMessage("אז ליום ראשון הבא ב20:00", SAT_2117, SAT_2117);
t("'יום ראשון הבא' במוצ\"ש = ראשון 27.9", !!nextSun?.line.includes("= יום ראשון 27.9"), true);
t("'יום ראשון הבא' - לא שואל", nextSun?.needsConfirm, false);
t("'חמישי' עם שבוע הבא מקודם בשיחה = 24.9",
  !!dayHintForMessage("חמישי", SAT_2117, SAT_2117, false, { nextWeek: true })?.line.includes("24.9"), true);
t("'מחר, יום שישי' ביום רביעי - שתי השורות, כדי שהסתירה תיראה",
  (() => { const l = dayHintForMessage("מחר, יום שישי", il("2026-09-16", "12:00"), il("2026-09-16", "12:00"))?.line ?? "";
    return l.includes("= יום חמישי 17.9") && l.includes("= יום שישי 18.9"); })(), true);

if (fails.length) {
  console.log(`\n${fails.length} נכשלו:\n`);
  for (const f of fails) console.log(`  ❌ ${f}\n`);
}
console.log(`${pass} עברו, ${fails.length} נכשלו`);
process.exit(fails.length ? 1 : 0);
