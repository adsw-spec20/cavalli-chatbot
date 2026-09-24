/**
 * הנוסחים ללקוח - עותק אחד בלבד, והפרומפט חייב לשאת אותו בדיוק.
 *
 * הרקע (24.9): הנוסחים שבעל העסק כתב (שישי, ראשון, שעות היום, ברק, שבת)
 * יושבים ב-RESERVATION_TEXTS בקוד, **והפרומפט מחזיק עותק שני מודפס בתוכו**.
 * שני עותקים של אותו טקסט נפרדים זה מזה בשקט - מספיק שמישהו יערוך אחד מהם.
 *
 * הבדיקה הזאת היא הרשת שמאפשרת לקצץ את כלל 14 בביטחון: אם עריכה תשנה
 * ולו תו אחד בנוסח שבפרומפט, היא תיפול כאן - בחינם, בלי קריאה למודל.
 *
 * הרצה: npx tsx scripts/reservation-wording-test.mts
 */
import { buildSystemPrompt } from "../src/lib/system-prompt";
import { businessConfig } from "../src/lib/business-config";
import { RESERVATION_TEXTS, BARAK_PHONE, GROUP_MIN_FOR_BARAK } from "../src/lib/reservation-policy";

let pass = 0;
const fails: string[] = [];
const t = (name: string, ok: boolean, detail = "") => {
  if (ok) pass++;
  else fails.push(`${name}${detail ? `\n     ${detail}` : ""}`);
};

const prompt = buildSystemPrompt(businessConfig, []);

// ===== כל נוסח מהקוד חייב להופיע בפרומפט כמו שהוא =====
// הנוסח נבדק שורה-שורה: הפרומפט מזיח את הטקסט פנימה, ולכן משווים כל שורה בנפרד.
const WORDINGS: Array<[string, string]> = [
  ["ברק", RESERVATION_TEXTS.barak],
  ["שישי", RESERVATION_TEXTS.friday],
  ["ראשון", RESERVATION_TEXTS.sunday],
  ["שעות היום", RESERVATION_TEXTS.daytime],
  ["שבת", RESERVATION_TEXTS.saturday],
  ["שאלת כמות", RESERVATION_TEXTS.askSize],
];
for (const [name, text] of WORDINGS) {
  const missing = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((line) => !prompt.includes(line));
  t(
    `נוסח "${name}" מופיע בפרומפט מילה במילה`,
    missing.length === 0,
    missing.length ? `שורות שלא נמצאו:\n     ${missing.join("\n     ")}` : ""
  );
}

// ===== מספרים שאסור שיתפצלו בין הקוד לפרומפט =====
t("טלפון ברק אחד בלבד", prompt.includes(BARAK_PHONE));
t(
  "אין מספר ברק אחר בפרומפט",
  !/05\d-\d{3}-\d{4}/.test(prompt.replace(new RegExp(BARAK_PHONE, "g"), "").replace(/050-979-8917/g, "")),
  "נמצא מספר נייד נוסף שאינו ברק ואינו מספר העסק"
);
t(`סף הקבוצה (${GROUP_MIN_FOR_BARAK}) מופיע בפרומפט`, prompt.includes(String(GROUP_MIN_FOR_BARAK)));

// ===== הגנות התנהגות שאסור שייעלמו בקיצוץ =====
// כל אחת מהן נוספה אחרי תקלה אמיתית מול לקוח.
const GUARDS: Array<[string, RegExp]> = [
  ["איסור לומר שהפיקדון מתקזז", /מתקזז|מנוכה מהחשבון/],
  ["תיעוד פער ידע על שאלת פיקדון שאין עליה תשובה", /report_knowledge_gap/],
  ["שני מקרי חיוב הפיקדון (אי-הגעה וגם ביטול מתחת ל-24 שעות)", /אי-הגעה/],
  ["איסור להתקפל מול תלונה על המדיניות", /אל תתקפל|אל תתנצל/],
  ["איסור לנסח כאילו ההזמנה אושרה", /אל תבטיח|אף מילה שמשתמעת ממנה אישור/],
  ["תנאי הברזל לקריאה לכלי", /request_reservation/],
  ["איסור לשלב שני תאים בתשובה אחת", /שני תאים|תא אחד/],
  ["ברק אינו הסלמה", /אינו הסלמה|לא הסלמה/],
];
for (const [name, rx] of GUARDS) t(`נשמרה ההגנה: ${name}`, rx.test(prompt));

if (fails.length) {
  console.log(`\n${fails.length} נכשלו:\n`);
  for (const f of fails) console.log(`  ❌ ${f}\n`);
}
console.log(`${pass} עברו, ${fails.length} נכשלו`);
process.exit(fails.length ? 1 : 0);
