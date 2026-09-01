// get-link.js <reservationId>  (READ-ONLY)
// Reads /reservations and prints the deposit link for one reservation.
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const PROFILE_DIR = path.join(__dirname, "tabit-profile");
const APP_URL = "https://tgm-app.tabit.cloud/";
const targetId = process.argv[2];

function waitForJson(page, matcher, timeoutMs = 45000) {
  return new Promise((resolve) => {
    let s = false;
    const done = (v) => { if (!s) { s = true; resolve(v); } };
    page.on("response", async (resp) => {
      try { if (matcher(resp.url()) && resp.status() === 200) { const j = await resp.json().catch(() => null); if (j) done(j); } } catch (_) {}
    });
    setTimeout(() => done(null), timeoutMs);
  });
}

async function readOnce() {
  try { for (const f of fs.readdirSync(PROFILE_DIR)) if (f.startsWith("Singleton")) try { fs.unlinkSync(path.join(PROFILE_DIR, f)); } catch (_) {} } catch (_) {}
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1280, height: 800 } });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const p = waitForJson(page, (u) => /\/reservations(\?|$)/.test(u));
  await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  const list = (await p) || [];
  await ctx.close();
  return list;
}

(async () => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const list = await readOnce();
    const r = list.find((x) => x._id === targetId);
    if (!r) { console.log(`attempt ${attempt}: reservation not found yet (${list.length} loaded)`); continue; }
    const d = r.reservation_details || {};
    const link = r.links && r.links.deposit;
    console.log(`\nname: ${d.customer && d.customer.name} | seats: ${d.seats_count} | from: ${d.reserved_from}`);
    console.log(`state: ${r.state} | cc_deposit: ${r.cc_deposit || "(none)"} | amount: ${r.cc_deposit_state && r.cc_deposit_state.total_amount}`);
    if (link) { console.log(`\nDEPOSIT_LINK: ${link}`); console.log(`MANAGEMENT_LINK: ${r.links.management || "(none)"}`); process.exit(0); }
    console.log(`attempt ${attempt}: deposit link not generated yet…`);
    await new Promise((r2) => setTimeout(r2, 4000));
  }
  console.log("\nלא נמצא קישור פיקדון עדיין - ייתכן שצריך עוד רגע, או שהוא נוצר רק כששולחים אותו מטאביט.");
  process.exit(0);
})();
