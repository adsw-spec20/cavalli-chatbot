/**
 * בדיקות לשכבת ההקשר של מעבדת טאביט: פענוח היום, שאלת ההבהרה שאחרי חצות,
 * ושורת המקור.
 *
 * כל בדיקה כאן היא תקלה שקרתה באמת מול הצוות (24.9):
 *   - "אתמול" ב-00:58 קיבל שאלת הבהרה עם **שני תאריכים שגויים**, כי המודל
 *     ניסח אותה. עכשיו הטקסט נבנה בקוד ואי אפשר לסלף אותו.
 *   - "כמה ביטולים היו ביום שלישי" נפתר קדימה, לשלישי הבא, כי הפותר נולד
 *     בשביל לקוח שמזמין מקום. הצוות שואל אחורה.
 *
 * הרצה: npx tsx scripts/lab-context-test.mts   (חינם, בלי רשת)
 */
import { labDayContext, labWeekdayDateIn } from "../src/lib/day-context";
import { buildSourceFooter, dayLabelHe } from "../src/lib/tabit-lab-data";

let pass = 0;
const fails: string[] = [];
const t = (name: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else fails.push(`${name}\n     קיבלנו:  ${JSON.stringify(got)}\n     ציפינו:  ${JSON.stringify(want)}`);
};
const has = (name: string, hay: string, needle: string) => t(name, hay.includes(needle), true);
const hasNot = (name: string, hay: string, needle: string) => t(name, hay.includes(needle), false);

/** רגע קבוע בשעון ישראל (ספטמבר = UTC+3) */
const at = (s: string) => new Date(`${s}+03:00`).getTime();

// 24.9.2026 הוא יום חמישי. 23.9 רביעי, 22.9 שלישי, 29.9 שלישי הבא.
const NIGHT = at("2026-09-24T01:18:00"); // אחרי חצות
const DAY = at("2026-09-24T14:00:00");   // אמצע היום

// ===== חלון החצות: שאלה שנבנית בקוד =====
const ambiguous = labDayContext("כמה אי הגעות וביטולים היו אתמול?", NIGHT);
t("אחרי חצות 'אתמול' מייצר שאלת הבהרה", typeof ambiguous.question, "string");
has("השאלה מציעה את המשמרת שנגמרה", ambiguous.question!, "יום רביעי 23.9");
has("השאלה מציעה את היום שלפניה", ambiguous.question!, "יום שלישי 22.9");
// זו בדיוק הטעות שהמודל עשה: הוא הציע "שלישי 23.9 או רביעי 24.9".
hasNot("השאלה לא מציעה את היום הנוכחי", ambiguous.question!, "24.9");
hasNot("השאלה לא מצמידה שלישי ל-23.9", ambiguous.question!, "שלישי 23.9");

const asked = labDayContext("כמה אי הגעות וביטולים היו אתמול?", NIGHT, true);
t("אחרי ששאלנו פעם אחת - לא שואלים שוב", asked.question, undefined);
has("ואז פותרים לפי הלוח", asked.line, "יום רביעי 23.9");

const explicit = labDayContext("כמה אי הגעות וביטולים היו ב-23.9?", NIGHT);
t("תאריך מפורש עוקף את שאלת ההבהרה", explicit.question, undefined);
has("ותאריך מפורש מפוענח ליום בשבוע", explicit.line, "יום רביעי 23.9");

// "היום" בלשון עבר אחרי חצות = המשמרת שהסתיימה, בלי לשאול.
const pastToday = labDayContext("כמה אנשים היו היום?", NIGHT);
t("'היום' בלשון עבר לא מצריך שאלה", pastToday.question, undefined);
has("'היום' בלשון עבר = היום שהסתיים", pastToday.line, "יום רביעי 23.9");

// ===== יום בשבוע: קדימה ללקוח, אחורה לצוות =====
t("לשון עבר: 'ביום שלישי' = השלישי שעבר",
  labWeekdayDateIn("כמה ביטולים היו ביום שלישי", "2026-09-24")?.iso, "2026-09-22");
t("לשון עתיד: 'ביום שלישי' = השלישי הבא",
  labWeekdayDateIn("יש מקום ביום שלישי", "2026-09-24")?.iso, "2026-09-29");
t("'שלישי הבא' נשאר קדימה גם בלשון עבר",
  labWeekdayDateIn("כמה היו ביום שלישי הבא", "2026-09-24")?.iso, "2026-09-29");
t("אותו יום בלשון עבר נשאר היום, לא שבוע אחורה",
  labWeekdayDateIn("כמה ביטולים היו ביום חמישי", "2026-09-24")?.iso, "2026-09-24");

const backwards = labDayContext("כמה אי הגעות היו ביום שלישי?", DAY);
has("ההקשר מזריק את היום שנפתר אחורה", backwards.line, "יום שלישי 22.9");

// ===== תוויות יום =====
t("היום", dayLabelHe("2026-09-24", "2026-09-24"), "היום, יום חמישי 24.9");
t("מחר", dayLabelHe("2026-09-25", "2026-09-24"), "מחר, יום שישי 25.9");
t("אתמול", dayLabelHe("2026-09-23", "2026-09-24"), "אתמול, יום רביעי 23.9");
t("יום רחוק", dayLabelHe("2026-09-20", "2026-09-24"), "יום ראשון 20.9");

// ===== שורת המקור =====
const footer = buildSourceFooter([
  { toolLabel: "אי-הגעות וביטולים ליום", scopeLabel: "אתמול, יום רביעי 23.9", source: "archive" },
], "01:20");
has("שורת המקור אומרת מתי נבדק", footer, "נבדק ב-01:20");
has("שורת המקור אומרת מה נבדק", footer, "אי-הגעות וביטולים ליום");
has("שורת המקור אומרת מאיפה", footer, "ארכיון טאביט");

const aged = buildSourceFooter([
  { toolLabel: "הזמנות היום", scopeLabel: "היום, יום חמישי 24.9", source: "snapshot", ageMinutes: 4 },
], "14:00");
has("תצלום מצהיר על הגיל שלו", aged, "לפני 4 דק'");

const deduped = buildSourceFooter([
  { toolLabel: "הזמנות היום", scopeLabel: "היום", source: "snapshot", ageMinutes: 2 },
  { toolLabel: "הזמנות היום", scopeLabel: "היום", source: "snapshot", ageMinutes: 2 },
], "14:00");
t("קריאה זהה פעמיים מופיעה פעם אחת", deduped.split("|").length, 1);
t("בלי כלים אין שורת מקור", buildSourceFooter([]), "");

if (fails.length) {
  console.log(`\n${fails.length} נכשלו:\n`);
  for (const f of fails) console.log(`  ❌ ${f}\n`);
}
console.log(`${pass} עברו, ${fails.length} נכשלו`);
process.exit(fails.length ? 1 : 0);
