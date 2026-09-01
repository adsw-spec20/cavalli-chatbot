// create-capture.js  (READ-ONLY observer - sends NOTHING to Tabit)
// Opens a real logged-in Tabit window. YOU create a reservation by hand.
// This script only LISTENS to the network: it records the write calls the
// app makes (so we learn the create-reservation API) and grabs the deposit
// link from the response. It never sends a write itself.

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const PROFILE_DIR = path.join(__dirname, "tabit-profile");
const APP_URL = "https://tgm-app.tabit.cloud/"; // NB: don't shadow the global URL constructor
const OUT = path.join(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, "writes.json");
const LINKS = path.join(OUT, "deposit-links.txt");

(async () => {
  try { for (const f of fs.readdirSync(PROFILE_DIR)) if (f.startsWith("Singleton")) try { fs.unlinkSync(path.join(PROFILE_DIR, f)); } catch (_) {} } catch (_) {}

  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: null,
    args: ["--window-position=80,60", "--window-size=1400,900", "--no-first-run", "--no-default-browser-check"],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());

  const captured = [];
  const isWrite = (u, m) => u.includes("tgm-api.tabit.cloud") && m !== "GET" && m !== "OPTIONS" && m !== "HEAD";

  page.on("request", (req) => {
    if (isWrite(req.url(), req.method())) {
      captured.push({ t: "req", method: req.method(), url: req.url(), postData: req.postData() || null });
    }
  });
  page.on("response", async (resp) => {
    const req = resp.request();
    if (!isWrite(resp.url(), req.method())) return;
    let body = null;
    try { if ((resp.headers()["content-type"] || "").includes("json")) body = await resp.json(); } catch (_) {}
    captured.push({ t: "resp", method: req.method(), url: resp.url(), status: resp.status(), body });
    fs.writeFileSync(LOG, JSON.stringify(captured, null, 2));
    console.log(`[captured] ${req.method()} ${new URL(resp.url()).pathname} -> ${resp.status()}`);
    const link = body && body.links && body.links.deposit;
    if (link) {
      const name = body.reservation_details && body.reservation_details.customer && body.reservation_details.customer.name;
      const line = `${new Date().toISOString()}  ${name || ""}  ${link}`;
      fs.appendFileSync(LINKS, line + "\n");
      console.log(`\n*** DEPOSIT LINK for ${name || "(reservation)"}: ${link} ***\n`);
    }
  });

  await page.goto(APP_URL, { waitUntil: "domcontentloaded" }).catch(() => {});
  for (let i = 0; i < 6; i++) { try { await page.bringToFront(); } catch (_) {} await page.waitForTimeout(1500); }

  console.log("\n==================================================");
  console.log("  חלון טאביט פתוח. צור הזמנה עתידית על שמך:");
  console.log("  שם, טלפון, תאריך, שעה, מספר סועדים - ושמור.");
  console.log("  כשסיימת, סגור את החלון.");
  console.log("==================================================\n");

  await new Promise((res) => { let done = false; const f = () => { if (!done) { done = true; res(); } }; ctx.on("close", f); page.on("close", f); setTimeout(f, 20 * 60 * 1000); });

  fs.writeFileSync(LOG, JSON.stringify(captured, null, 2));
  console.log("saved captures to", LOG);
  try { await ctx.close(); } catch (_) {}
  process.exit(0);
})();
