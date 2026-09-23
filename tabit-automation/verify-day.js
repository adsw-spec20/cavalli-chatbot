// בדיקה ידנית של הנתון היומי מול טאביט האמיתי, בלי לעבור דרך השרת והמודל.
//
// נולד מהשאלה "איך אני מוודא בעצמי שהמספר שהבוט אמר נכון?". הסקריפט מריץ את
// **אותן פונקציות** שהסוכן מריץ (require של agent.js, לא העתק שלהן), ומדפיס
// זו לצד זו את שתי התשובות שבלבלו בין זו לזו:
//
//   day_outcome של היום המבוקש   = מה באמת קרה באותו יום
//   no_show_summary של תקופה      = צבירה מתגלגלת שמסתיימת עכשיו
//
// ⚠️ צריך את הפרופיל המחובר, ולכן יש לעצור קודם את הסוכן (הוא נועל אותו).
//
// הרצה: node verify-day.js 2026-09-23

const a = require("./agent.js");

(async () => {
  const day = process.argv[2] || a.resolveDay("yesterday");
  a.loadCreds();
  const b = await a.launchBrowser();
  try {
    const outcome = await a.actDayOutcome(b.page, { day });
    console.log(`\n===== ${day} (יום בודד, לפי שעת ההזמנה) =====`);
    console.log(JSON.stringify({
      coverage: outcome.coverage,
      booked_total: outcome.booked_total,
      no_show: outcome.no_show,
      cancelled: outcome.cancelled,
      arrived: outcome.arrived,
      walk_ins: outcome.walk_ins,
      walk_in_no_show: outcome.walk_in_no_show,
      no_show_rate_pct: outcome.no_show_rate_pct,
      covers: outcome.covers,
    }, null, 2));
    console.log("\nאי-הגעות:");
    for (const r of outcome.no_show_list || []) console.log(`  ${r.time}  ${r.name}  ${r.seats} סועדים  ${r.phone}`);
    console.log("ביטולים:");
    for (const r of outcome.cancelled_list || []) console.log(`  ${r.time}  ${r.name}  ${r.seats} סועדים  ${r.phone}`);

    for (const days of [1, 30]) {
      const p = await a.actNoShowSummary(b.page, { days });
      console.log(`\n===== צבירה מתגלגלת, days=${days} (${p.window_from} עד ${p.window_to}) =====`);
      if (p.unavailable) { console.log(`  לא זמין: ${p.message}`); continue; }
      console.log(JSON.stringify({
        booked_total: p.booked_total, no_show: p.no_show, cancelled: p.cancelled,
        completed: p.completed, walk_ins: p.walk_ins, no_show_rate_pct: p.no_show_rate_pct,
      }, null, 2));
    }
  } catch (e) {
    console.error("נכשל:", e && e.message);
    process.exitCode = 1;
  } finally {
    await b.ctx.close().catch(() => {});
  }
})();
