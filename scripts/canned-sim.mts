/**
 * סימולציה: כמה מהתורים שעלו כסף בפועל היו נענים בחינם עם הלוגיקה הנוכחית.
 * עלות אפס - לא נשלח דבר למודל.
 *   npx tsx scripts/canned-sim.mts <convs.json>
 */
import { readFileSync } from "fs";
import { matchQuickAnswers } from "../src/lib/conversation-service";

const COMPLAINT_RX =
  /התלונ|תלונה|להתלונן|מאוכזב|אכזב|לא חזר[וה]? אליי|לא חזרתם|אף אחד לא ענה|לא ענ(ה|יתם)|גרוע|מזעזע|בושה|לא מקובל|חוצפה|עצבן|כועס|מתוסכל|דורש החזר|תחזירו לי|פעם אחרונה/;
function hasSecondAsk(text: string): boolean {
  const lines = [...new Set(text.split("\n").map((s) => s.trim()).filter(Boolean))];
  const rest = lines.length > 1 ? lines.filter((l) => matchQuickAnswers(l).length === 0) : lines;
  const t = rest.join("\n").trim();
  if (!t) return false;
  if ((t.match(/\?/g) ?? []).length >= 2) return true;
  return /(^|[\s,.!?])(אבל|וגם|בנוסף|חוץ מזה|ועוד שאלה|ודרך אגב|אגב,|קודם תגיד|לפני זה)(\s|$)/.test(t);
}
// הגרסה הישנה, לצורך השוואה
function hasSecondAskOld(text: string): boolean {
  const t = text.trim();
  if ((t.match(/\?/g) ?? []).length >= 2) return true;
  return /(^|[\s,.!?])(אבל|וגם|בנוסף|חוץ מזה|ועוד שאלה|ודרך אגב|אגב,|קודם תגיד|לפני זה)(\s|$)/.test(t);
}

interface Msg { role: string; content: string; meta?: Record<string, unknown> }
const convs: { messages: Msg[] }[] = JSON.parse(readFileSync(process.argv[2], "utf8"));
const turns: { turn: string; wasModel: boolean }[] = [];
for (const c of convs) {
  let buf: string[] = [];
  for (const m of c.messages) {
    if (m.role === "user") { buf.push(m.content); continue; }
    if (m.role === "assistant" && buf.length) {
      const meta = m.meta ?? {};
      turns.push({ turn: buf.join("\n"), wasModel: !(meta.canned || meta.gateReply) });
      buf = [];
    } else if (m.role === "assistant") buf = [];
  }
}
const wouldBeFree = (t: string, oldLogic: boolean) => {
  const keys = matchQuickAnswers(t);
  if (!keys.length) return false;
  const forced = COMPLAINT_RX.test(t) || (oldLogic ? hasSecondAskOld(t) : hasSecondAsk(t));
  return !forced;
};
let paid = 0, fixedNow = 0, freeBefore = 0;
for (const { turn, wasModel } of turns) {
  if (!wasModel) continue;
  paid++;
  if (wouldBeFree(turn, true)) freeBefore++;
  if (wouldBeFree(turn, false)) fixedNow++;
}
console.log(`תורים שעלו כסף בפועל: ${paid}`);
console.log(`היו נענים בחינם בלוגיקה הישנה: ${freeBefore}`);
console.log(`ייענו בחינם בלוגיקה החדשה:   ${fixedNow}`);
console.log(`\nשיפור: +${fixedNow - freeBefore} תורים = ${(((fixedNow - freeBefore) / paid) * 100).toFixed(0)}% מהתורים בתשלום עוברים לחינם`);
// שפיות: לוודא שתלונה עדיין נשלחת למודל
const t1 = "התלוננתי אתמול ואף אחד לא חזר אליי, מה שעות הפעילות?";
const t2 = "יש חניה? ומה המחיר של הקרואסון?";
console.log(`\nבדיקות שפיות (true = הולך למודל, כרצוי):`);
console.log(`  תלונה+שעות: ${!wouldBeFree(t1, false)}`);
console.log(`  שתי שאלות בשורה אחת: ${!wouldBeFree(t2, false)}`);
console.log(`  שני כפתורים (שעות+מיקום): ${!wouldBeFree("מהן שעות הפעילות שלכם?\nאיפה אתם ממוקמים ואיך מגיעים?", false)} (רצוי false)`);
console.log(`  אותו כפתור פעמיים: ${!wouldBeFree("איפה אתם ממוקמים ואיך מגיעים?\nאיפה אתם ממוקמים ואיך מגיעים?", false)} (רצוי false)`);
