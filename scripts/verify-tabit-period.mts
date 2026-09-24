/**
 * מאמת את הקריאה ההיסטורית מטאביט: יום בודד ישן, וטווח של כמה ימים.
 *
 * עד 24.9 חשבנו שהארכיון נגיש ל-24 שעות בלבד. הוא נגיש לכל יום - המגבלה היא
 * על **גודל החלון**, והפרמטר שסוגר אותו נקרא `until` ולא `to`. הסקריפט הזה
 * מוכיח את זה מול נתוני אמת ומודד כמה זמן לוקחת תקופה.
 *
 * ⚠️ דורש שהסוכן יהיה עצור.
 * הרצה: NODE_OPTIONS=--use-system-ca npx tsx scripts/verify-tabit-period.mts [ימים]
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const a = require("../tabit-automation/agent.js");

const DAYS = Number(process.argv[2] || 7);
const b = await a.launchBrowser();

try {
  const today = a.todayIL();
  const addDays = (iso: string, n: number) => {
    const [y, m, d] = iso.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
  };

  // --- יום ישן, שהחלון המתגלגל של 24 שעות לא היה מגיע אליו בשום אופן ---
  const oldDay = addDays(today, -10);
  console.log(`\n===== יום ישן: ${oldDay} (לפני 10 ימים) =====`);
  const started1 = Date.now();
  const outcome = await a.actDayOutcome(b.page, { day: oldDay });
  console.log(`  ${((Date.now() - started1) / 1000).toFixed(1)} שניות`);
  console.log(`  אי-הגעות: ${outcome.no_show}  ביטולים: ${outcome.cancelled}  הגיעו: ${outcome.arrived}  מזדמנים: ${outcome.walk_ins}`);
  console.log(`  מתוך אי-ההגעות: ${outcome.no_show_reservations} הזמנות, ${outcome.no_show_walkins} מזדמנים`);
  console.log(`  ביטולים בלי לקוח (לא נספרים): ${outcome.cancelled_without_customer}`);

  // --- כל יום בשבוע האחרון בנפרד, כדי לראות שאין ימים ריקים בטעות ---
  console.log(`\n===== יום-יום, ${DAYS} הימים האחרונים =====`);
  for (let i = DAYS; i >= 1; i--) {
    const d = addDays(today, -i);
    const o = await a.actDayOutcome(b.page, { day: d });
    console.log(`  ${d}  אי-הגעות ${String(o.no_show).padStart(3)}  ביטולים ${String(o.cancelled).padStart(3)}  הזמנות ${String(o.booked_total).padStart(3)}  מזדמנים ${String(o.walk_ins).padStart(4)}`);
  }

  // --- צבירה על תקופה ---
  console.log(`\n===== צבירה על ${DAYS} ימים =====`);
  const started2 = Date.now();
  const period = await a.actNoShowSummary(b.page, { days: DAYS });
  console.log(`  ${((Date.now() - started2) / 1000).toFixed(1)} שניות`);
  console.log(`  ${period.window_from} עד ${period.window_to} (${period.window_days} ימים)`);
  console.log(`  אי-הגעות ${period.no_show} (מהן ${period.no_show_reservations} הזמנות), ביטולים ${period.cancelled}, הזמנות ${period.booked_total}, מזדמנים ${period.walk_ins}`);
  console.log(`  לקוחות שלא הגיעו יותר מפעם אחת: ${period.repeat_no_show_customers.length}`);
  for (const c of period.repeat_no_show_customers.slice(0, 8)) console.log(`     ${c.name || "(ללא שם)"} ${c.phone} - ${c.no_shows} פעמים`);

  const sources = await a.actBookingSources(b.page, { days: DAYS });
  console.log(`\n  מקורות ההזמנות ב-${sources.window_days} ימים: ${sources.breakdown.map((x: { source: string; count: number; pct: number }) => `${x.source} ${x.count} (${x.pct}%)`).join(" · ")}`);

  const rev = await a.actRevenueSummary(b.page, { days: DAYS });
  console.log(`  הכנסות ב-${rev.window_days} ימים: ${rev.revenue_ils} ש"ח ב-${rev.orders} חשבונות, ממוצע לסועד ${rev.per_person_ils}`);
} finally {
  await b.ctx.close().catch(() => {});
}
