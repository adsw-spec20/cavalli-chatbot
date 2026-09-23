/**
 * מאמת את פנקס היומיים מול טאביט האמיתי, בלי לשלוח כלום לשרת.
 *
 * שתי שאלות:
 *   מה הסוכן בעצם אוסף, וכמה זה שוקל.
 *   האם החישוב מעל הפנקס נותן את אותה תשובה כמו קריאה ישירה מטאביט.
 *
 * הסכמה מלאה בין שני המסלולים היא מה שמאפשר לסמוך על הפנקס לימים שטאביט כבר
 * לא מחזיק (הארכיון שלו נגיש ל-24 שעות בלבד).
 *
 * ⚠️ דורש שהסוכן יהיה עצור - הוא נועל את פרופיל הדפדפן.
 * הרצה: NODE_OPTIONS=--use-system-ca npx tsx scripts/verify-tabit-ledger.mts
 */
import { createRequire } from "module";
import { computeDayOutcome, computeRevenue, computeSources, type LedgerRecord } from "../src/lib/tabit-ledger";

const require = createRequire(import.meta.url);
const a = require("../tabit-automation/agent.js");

const b = await a.launchBrowser();
try {
  const tables = await a.getTables(b.page);
  const ledger: Record<string, LedgerRecord[]> | null = await a.collectLedger(
    b.page,
    new Map(tables.map((t: { _id: string; number: number }) => [t._id, t.number]))
  );
  if (!ledger) {
    console.log("collectLedger החזיר null - הארכיון לא הגיב");
    process.exit(1);
  }

  const days = Object.keys(ledger).sort();
  const total = days.reduce((s, d) => s + ledger[d].length, 0);
  const bytes = JSON.stringify(ledger).length;
  console.log("\n===== מה הסוכן אוסף =====");
  console.log(`  ${total} רשומות ב-${days.length} ימים, ${(bytes / 1024).toFixed(0)}KB לשליחה`);
  for (const d of days) console.log(`    ${d}: ${ledger[d].length} רשומות`);
  console.log("\n  דוגמה:");
  console.log(JSON.stringify(ledger[days[0]][0], null, 2).split("\n").map((l) => "    " + l).join("\n"));

  // אותו יום, שני מסלולים. חייבים להסכים, אחרת אי אפשר לסמוך על הפנקס.
  const today = a.todayIL();
  const day = days.find((d) => d < today) ?? days[0];
  const direct = await a.actDayOutcome(b.page, { day });
  const viaLedger = computeDayOutcome(ledger[day], day);
  console.log(`\n===== הצלבה ל-${day}: קריאה ישירה מטאביט מול חישוב מעל הפנקס =====`);
  let mismatch = 0;
  for (const k of ["booked_total", "no_show", "cancelled", "arrived", "walk_ins", "walk_in_no_show"] as const) {
    const same = direct[k] === viaLedger[k];
    if (!same) mismatch++;
    console.log(`  ${same ? "✓" : "✗"} ${k}: טאביט=${direct[k]}  פנקס=${viaLedger[k]}`);
  }
  console.log(`\n  הכנסות מהפנקס: ${JSON.stringify(computeRevenue(ledger[day], day))}`);
  console.log(`  מקורות מהפנקס: ${JSON.stringify(computeSources(ledger[day], day).breakdown)}`);
  console.log(mismatch ? `\n❌ ${mismatch} שדות לא תואמים` : "\n✅ שני המסלולים מסכימים");
  process.exitCode = mismatch ? 1 : 0;
} finally {
  await b.ctx.close().catch(() => {});
}
