// sync.js
// The bridge. Reads live reservations from Tabit (piggybacking on the app's
// own API calls, using the saved login) and POSTs a normalized snapshot to the
// chatbot's ingest endpoint. READ-ONLY against Tabit.
//
// Config (env or ./sync-config.json, gitignored):
//   TABIT_SYNC_URL     full ingest URL, e.g. https://<app>/api/admin/tabit/ingest
//   TABIT_SYNC_SECRET  shared secret, must match the server's TABIT_SYNC_SECRET
//
// Usage:
//   node sync.js          -> read Tabit and POST the snapshot
//   node sync.js --dry     -> read Tabit and PRINT the snapshot (no POST)

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const PROFILE_DIR = path.join(__dirname, "tabit-profile");
const APP_URL = "https://tgm-app.tabit.cloud/";
const TZ = "Asia/Jerusalem";

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("he-IL", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });

function loadConfig() {
  const cfg = { url: process.env.TABIT_SYNC_URL || "", secret: process.env.TABIT_SYNC_SECRET || "" };
  try {
    const f = JSON.parse(fs.readFileSync(path.join(__dirname, "sync-config.json"), "utf8"));
    if (!cfg.url) cfg.url = f.url || "";
    if (!cfg.secret) cfg.secret = f.secret || "";
  } catch (_) {}
  return cfg;
}

// מצב הפיקדון כפי שטאביט מציג אותו:
//  secured = הפיקדון מובטח (נתפס כרטיס אשראי) -> יש cc_deposit. טאביט: תקין.
//  missing = דורש פיקדון (יש קישור פיקדון) אבל לא מובטח -> טאביט מסמן "חסר פיקדון".
//  none    = לא מעורב פיקדון בכלל.
// חשוב: notified_deposit ("נשלח קישור") הוא לא הסימן - הזמנה יכולה לקבל קישור
// ולא לשלם. הסימן האמיתי הוא cc_deposit (ראה deposit-debug מול נתוני אמת).
function depositStatus(r) {
  if (r.deposit_removed) return "none";
  const st = r.cc_deposit_state && r.cc_deposit_state.state;
  const dead = ["refunded", "canceled", "cancelled", "voided", "removed", "expired"];
  const secured = !!r.cc_deposit && !(st && dead.includes(st));
  if (secured) return "secured";
  const required = !!(r.links && r.links.deposit);
  return required ? "missing" : "none";
}

function waitForJson(page, matcher, timeoutMs = 45000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    page.on("response", async (resp) => {
      try {
        if (!matcher(resp.url()) || resp.status() !== 200) return;
        const j = await resp.json().catch(() => null);
        if (j) done(j);
      } catch (_) {}
    });
    setTimeout(() => done(null), timeoutMs);
  });
}

async function readTabit() {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    viewport: { width: 1280, height: 800 },
  });
  const page = context.pages()[0] || (await context.newPage());
  const reservationsP = waitForJson(page, (u) => /\/reservations(\?|$)/.test(u));
  const tablesP = waitForJson(page, (u) => /\/tables(\?|$)/.test(u));
  await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  const reservations = (await reservationsP) || [];
  const tables = (await tablesP) || [];
  await context.close();
  return { reservations, tables };
}

function normalize({ reservations, tables }) {
  const tableNum = new Map(tables.map((t) => [t._id, t.number]));
  return reservations
    .filter((r) => r && r.type !== "walked_in")
    .map((r) => {
      const d = r.reservation_details || {};
      const from = d.reserved_from;
      return {
        id: r._id,
        name: (d.customer && d.customer.name) || "",
        phone: (d.customer && d.customer.phone) || "",
        seats: d.seats_count || 0,
        fromISO: from || null,
        day: from ? dayFmt.format(new Date(from)) : null,
        time: from ? timeFmt.format(new Date(from)) : "",
        tables: (d.reserved_tables_ids || []).map((id) => tableNum.get(id)).filter((n) => n != null),
        state: r.state || "",
        type: r.type || "",
        deposit: depositStatus(r),
      };
    })
    .filter((r) => r.fromISO); // חייב תאריך כדי להיות שימושי
}

(async () => {
  const dry = process.argv.includes("--dry");
  const cfg = loadConfig();

  const raw = await readTabit();
  if (!raw.reservations.length) {
    console.error("לא התקבלו הזמנות מטאביט - ייתכן שה-session פג. הרץ שוב: node login.js");
    process.exit(1);
  }
  const normalized = normalize(raw);
  const snapshot = { generatedAt: Date.now(), reservations: normalized };

  const missing = normalized.filter((r) => r.deposit === "missing").length;
  console.log(`נקראו ${raw.reservations.length} הזמנות, אחרי סינון: ${normalized.length}. חסרי פיקדון: ${missing}.`);

  if (dry || !cfg.url || !cfg.secret) {
    if (!dry) console.error("\n(אין TABIT_SYNC_URL/SECRET - מצב הדגמה בלבד, לא נשלח לשרת)");
    console.log("\n--- דוגמה (5 ראשונות) ---");
    console.log(JSON.stringify(normalized.slice(0, 5), null, 2));
    process.exit(0);
  }

  const res = await fetch(cfg.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-tabit-sync-secret": cfg.secret },
    body: JSON.stringify(snapshot),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`שליחה נכשלה: ${res.status} ${text}`);
    process.exit(1);
  }
  console.log(`נשלח בהצלחה לשרת: ${text}`);
  process.exit(0);
})();
