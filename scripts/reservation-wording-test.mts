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
import { policyVerdictFor } from "../src/lib/reservation-availability";

let pass = 0;
const fails: string[] = [];
const t = (name: string, ok: boolean, detail = "") => {
  if (ok) pass++;
  else fails.push(`${name}${detail ? `\n     ${detail}` : ""}`);
};

const prompt = buildSystemPrompt(businessConfig, []);

// ===== עותק אחד בלבד לכל נוסח (24.9) =====
// עד הקיצוץ הנוסחים הופיעו **גם** בקוד וגם מודפסים בתוך הפרומפט. עכשיו הקוד
// שולח אותם בתוך שורת ההכרעה, והפרומפט לא מחזיק אותם כלל - ולכן הבדיקה
// התהפכה: היא מוודאת שאין עותק שני שיכול להיפרד מהמקור.
const SINGLE_SOURCE: Array<[string, string]> = [
  ["ברק", RESERVATION_TEXTS.barak],
  ["שישי", RESERVATION_TEXTS.friday],
  ["ראשון", RESERVATION_TEXTS.sunday],
  ["שעות היום", RESERVATION_TEXTS.daytime],
  ["שבת", RESERVATION_TEXTS.saturday],
];
for (const [name, text] of SINGLE_SOURCE) {
  const dup = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 25)
    .filter((line) => prompt.includes(line));
  t(
    `נוסח "${name}" אינו משוכפל בפרומפט`,
    dup.length === 0,
    dup.length ? `נמצא עותק שני:\n     ${dup.join("\n     ")}` : ""
  );
}
// "כמה תהיו?" נשאר בפרומפט: הוא נשאל בשלב 1, לפני שיש בכלל הכרעה.
t("נוסח שאלת הכמות נשאר בפרומפט", prompt.includes(RESERVATION_TEXTS.askSize));


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

// ===== שורת ההכרעה נושאת את הנוסח עצמו (24.9) =====
// זה מה שמאפשר להוריד את הנוסחים מהפרומפט: הקוד שולח אותם, לא המודל משחזר.
// התאריכים נגזרים מהיום כדי שהבדיקה לא תפוג.
const nextDow = (dow: number) => {
  const d = new Date();
  d.setDate(d.getDate() + ((dow - d.getDay() + 7) % 7 || 7));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const verdictLine = (s2: { dateISO?: string; time?: string; people?: number }) =>
  policyVerdictFor(businessConfig, s2)?.line ?? "";

const CASES: Array<[string, { dateISO?: string; time?: string; people?: number }, string]> = [
  ["שישי", { dateISO: nextDow(5), time: "11:00", people: 4 }, RESERVATION_TEXTS.friday],
  ["ראשון", { dateISO: nextDow(0), time: "12:00", people: 4 }, RESERVATION_TEXTS.sunday],
  ["שני לפני 18:00", { dateISO: nextDow(1), time: "10:00", people: 4 }, RESERVATION_TEXTS.daytime],
  ["שבת", { dateISO: nextDow(6), time: "12:00", people: 4 }, RESERVATION_TEXTS.saturday],
  ["ברק (9 בשישי)", { dateISO: nextDow(5), time: "11:00", people: 9 }, RESERVATION_TEXTS.barak],
];
for (const [name, slots, expected] of CASES) {
  const line = verdictLine(slots);
  const missing = expected.split("\n").map((l) => l.trim()).filter(Boolean).filter((l) => !line.includes(l));
  t(`הכרעת "${name}" נושאת את הנוסח המדויק`, missing.length === 0, missing.join(" | ") || line.slice(0, 120));
}
// קבוצה גדולה מוכרעת גם בלי תאריך - אחרת אין מאיפה לקחת את נוסח ברק
t(
  "9 סועדים בלי תאריך - עדיין ברק עם הנוסח",
  verdictLine({ people: 12 }).includes(RESERVATION_TEXTS.barak),
  verdictLine({ people: 12 }).slice(0, 120) || "(אין שורת הכרעה)"
);
t("8 סועדים בלי תאריך - אין הכרעה", verdictLine({ people: 8 }) === "");

if (fails.length) {
  console.log(`\n${fails.length} נכשלו:\n`);
  for (const f of fails) console.log(`  ❌ ${f}\n`);
}
console.log(`${pass} עברו, ${fails.length} נכשלו`);
process.exit(fails.length ? 1 : 0);
