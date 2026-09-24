/**
 * חותך את כלל 14 ל-12 הסעיפים שמוצגים במסמך הסקירה, ומוציא JSON.
 *
 * ⚠️ למה זה סקריפט ולא העתקה ידנית: בגרסה הראשונה של המסמך כתבתי את "הנוסח
 * הקיים" בעצמי עם "..." באמצע, והתוצאה הייתה תקציר בן 742 תווים שהוצג לצד
 * נוסח מוצע מלא בן 746 - כאילו אין הבדל, בזמן שהסעיף האמיתי הוא 1,917 תווים.
 * מכאן והלאה הטקסט נשלף מהמקור, וסכום הסעיפים נבדק מול הסך הכולל.
 *
 * הרצה: npx tsx scripts/rule14-sections.mts > scan-data/rule14-sections.json
 */
import { readFileSync } from "fs";

const txt = readFileSync("scan-data/rule14-live.txt", "utf8");
const tok = (s: string) => Math.round(s.length / 1.43);

const at = (rx: RegExp) => {
  const i = txt.search(rx);
  if (i < 0) throw new Error(`לא נמצא: ${rx}`);
  return i;
};

const iS1 = at(/\*\*▸ שלב 1/);
const iS2 = at(/\*\*▸ שלב 2/);
const iS3 = at(/\*\*▸ שלב 3/);
const iS4 = at(/\*\*▸ שלב 4/);

/** תבליטי שלב 4, כל אחד עד התבליט הבא */
const s4 = txt.slice(iS4);
const bullets: string[] = [];
let cur = "";
for (const line of s4.split("\n")) {
  if (/^   - /.test(line)) {
    if (cur) bullets.push(cur);
    cur = line;
  } else cur += (cur ? "\n" : "") + line;
}
if (cur) bullets.push(cur);
// bullets[0] הוא כותרת שלב 4 עצמה
const head4 = bullets[0];
const b = bullets.slice(1);
const join = (from: number, to: number) => b.slice(from, to).join("\n");

const sections = [
  { id: "head", text: txt.slice(0, iS1) },
  { id: "gates", text: txt.slice(iS1, iS2) },
  { id: "table", text: txt.slice(iS2, iS3) },
  { id: "one", text: txt.slice(iS3, iS4) },
  { id: "first", text: `${head4}\n${b[0]}` },
  { id: "slots", text: b[1] },
  { id: "collect", text: b[2] },
  { id: "dup9", text: b[3] },
  { id: "dates", text: b[4] },
  { id: "summary", text: b[5] },
  { id: "deposit", text: join(6, 12) },
  { id: "tool", text: join(12, b.length) },
].map((s) => ({ ...s, text: s.text.replace(/\s+$/, ""), tokens: tok(s.text.replace(/\s+$/, "")) }));

const sum = sections.reduce((a, s) => a + s.tokens, 0);
const whole = tok(txt.trim());
if (Math.abs(sum - whole) > 40) {
  throw new Error(`סכום הסעיפים ${sum} לא תואם לכלל המלא ${whole} - הקיטוע פספס טקסט`);
}
process.stderr.write(`סכום הסעיפים: ${sum} · הכלל המלא: ${whole} · פער ${Math.abs(sum - whole)}\n`);
process.stdout.write(JSON.stringify(sections, null, 1));
