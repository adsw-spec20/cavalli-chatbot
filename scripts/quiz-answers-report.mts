// דוח קריאה בלבד: כמה שאלות נענו בשאלון עד סעיף י' (לתכנון ההטמעה)
// הרצה: npx tsx scripts/quiz-answers-report.mts <path-to-answers.json>
import { QUIZ } from "../src/app/admin/questionnaire-data";
import { readFileSync } from "fs";

const answersPath = process.argv[2];
const answers = JSON.parse(readFileSync(answersPath, "utf8").replace(/^﻿/, "")) as Record<
  string,
  { answer?: string; skipped?: boolean }
>;

const upToYud = QUIZ.slice(0, 10); // א' עד י'
let total = 0;
let answered = 0;
let skipped = 0;
for (const cat of upToYud) {
  const catAnswered = cat.questions.filter((q) => answers[q.id]?.answer).length;
  const catSkipped = cat.questions.filter((q) => answers[q.id]?.skipped && !answers[q.id]?.answer).length;
  total += cat.questions.length;
  answered += catAnswered;
  skipped += catSkipped;
  console.log(`${cat.name}: ${cat.questions.length} שאלות, ${catAnswered} נענו, ${catSkipped} דולגו`);
}
console.log(`--- סה"כ עד י': ${total} שאלות, ${answered} נענו, ${skipped} דולגו ---`);

const after = QUIZ.slice(10);
const afterAnswered = after.reduce((a, c) => a + c.questions.filter((q) => answers[q.id]?.answer).length, 0);
console.log(`אחרי י' (יא-טו): ${after.reduce((a, c) => a + c.questions.length, 0)} שאלות, ${afterAnswered} נענו`);

console.log("\n--- התשובות עצמן (עד י') ---");
for (const cat of upToYud) {
  for (const q of cat.questions) {
    const a = answers[q.id];
    if (a?.answer) console.log(`[${q.id}] ${q.text.slice(0, 70)}\n   => ${a.answer.slice(0, 120)}`);
  }
}
