/**
 * מריץ את כל בדיקות היחידה של הפרויקט ברצף.
 *
 * כולן לוגיקה טהורה: **אפס קריאות למודל, אפס עלות, אפס גישה לפרודקשן**. זה
 * ההבדל מחבילת ה-eval (scripts/eval.mjs), שמדברת עם המודל האמיתי ולכן עולה
 * כסף ורצה ממוקד. כל מה שאפשר להכריע בקוד נבדק כאן, וכאן זה זול להריץ בכל שינוי.
 *
 * הרצה:  npm run unit
 */
import { spawnSync } from "node:child_process";

const SUITES = [
  ["פענוח מילות זמן וחצות", "scripts/day-context-test.mts"],
  ["פתוח/סגור והושבה אחרונה", "scripts/open-state-test.mts"],
  ["זיהוי הזמנה ביומן טאביט", "scripts/tabit-lookup-test.mts"],
  ["פורמט רשימות טאביט", "scripts/tabit-format-test.mts"],
  ["לוגיקת מעבדת טאביט", "scripts/tabit-smart-test.mts"],
  ["לחיצה כפולה וגבול הפרק", "scripts/episode-guard-test.mts"],
];

let failed = 0;
for (const [title, file] of SUITES) {
  process.stdout.write(`\n▸ ${title}\n`);
  const r = spawnSync("npx", ["tsx", file], { stdio: "inherit", shell: true });
  if (r.status !== 0) failed++;
}

console.log(
  failed
    ? `\n❌ ${failed} מתוך ${SUITES.length} חבילות נכשלו`
    : `\n✅ כל ${SUITES.length} חבילות הבדיקה עברו`
);
process.exit(failed ? 1 : 0);
