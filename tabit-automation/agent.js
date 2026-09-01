// agent.js - always-on local agent for the Tabit test lab.
// Keeps ONE authenticated Tabit browser open, polls the server queue, and runs
// each command against Tabit using the app's own session. READ + additive
// CREATE only. It has NO code path that modifies/cancels/deletes reservations.
//
// Config (env or ./sync-config.json): TABIT_SYNC_URL (the /ingest url) + TABIT_SYNC_SECRET.
// The agent endpoint is derived by swapping /ingest -> /agent.

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const PROFILE_DIR = path.join(__dirname, "tabit-profile");
const APP_URL = "https://tgm-app.tabit.cloud/";
const API = "https://tgm-api.tabit.cloud";
const ORG_ID = "68f0eebde7aadd617c316921";
const TZ = "Asia/Jerusalem";
const POLL_MS = 2500;

const HEADERS = {
  "x-org-id": ORG_ID,
  "x-org-name": "%D7%A7%D7%A4%D7%94%20%D7%A7%D7%95%D7%95%D7%90%D7%9C%D7%99%20%D7%95%D7%9E%D7%A1%D7%A2%D7%93%D7%94",
  "x-tg-device-name": "17525a1739a1a6462597151414a19a49_1788253833494",
  "x-app-version": "12.1.0",
  "content-type": "application/json",
  accept: "application/json, text/plain, */*",
};

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("he-IL", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });

function loadConfig() {
  const cfg = { url: process.env.TABIT_SYNC_URL || "", secret: process.env.TABIT_SYNC_SECRET || "" };
  try {
    const f = JSON.parse(fs.readFileSync(path.join(__dirname, "sync-config.json"), "utf8"));
    if (!cfg.url) cfg.url = f.url || "";
    if (!cfg.secret) cfg.secret = f.secret || "";
  } catch (_) {}
  cfg.agentUrl = cfg.url.replace(/\/ingest\/?$/, "/agent");
  return cfg;
}

function todayIL() { return dayFmt.format(new Date()); }
function resolveDay(day) {
  if (day === "today" || !day) return todayIL();
  if (day === "tomorrow") return dayFmt.format(new Date(Date.now() + 86400000));
  return day; // assume YYYY-MM-DD
}
/** Israel local date+time -> UTC ISO (DST-correct) */
function ilToUtcISO(date, time) {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = (time || "00:00").split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const parts = dtf.formatToParts(new Date(guess));
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
  const offset = asUTC - guess;
  return new Date(guess - offset).toISOString();
}

function depositStatus(r) {
  if (r.deposit_removed) return "none";
  const st = r.cc_deposit_state && r.cc_deposit_state.state;
  const dead = ["refunded", "canceled", "cancelled", "voided", "removed", "expired"];
  const secured = !!r.cc_deposit && !(st && dead.includes(st));
  if (secured) return "secured";
  return r.links && r.links.deposit ? "missing" : "none";
}

async function apiFetch(page, method, apiPath, bodyObj) {
  return page.evaluate(
    async ({ API, method, apiPath, bodyObj, HEADERS }) => {
      const res = await fetch(API + apiPath, { method, headers: HEADERS, credentials: "include", body: bodyObj ? JSON.stringify(bodyObj) : undefined });
      let body = null;
      try { body = await res.json(); } catch (_) {}
      return { status: res.status, body };
    },
    { API, method, apiPath, bodyObj: bodyObj || null, HEADERS }
  );
}

async function getReservations(page) {
  const r = await apiFetch(page, "GET", `/reservations?tgmv=${Date.now()}`);
  if (r.status !== 200 || !Array.isArray(r.body)) throw new Error(`קריאת הזמנות נכשלה (status ${r.status}) - ייתכן שה-session פג, הרץ login.js`);
  return r.body;
}
async function getTables(page) {
  const r = await apiFetch(page, "GET", `/tables?tgmv=${Date.now()}`);
  return r.status === 200 && Array.isArray(r.body) ? r.body : [];
}

function mapReservation(r, tableNum) {
  const d = r.reservation_details || {};
  return {
    id: r._id,
    name: (d.customer && d.customer.name) || "",
    phone: (d.customer && d.customer.phone) || "",
    seats: d.seats_count || 0,
    time: d.reserved_from ? timeFmt.format(new Date(d.reserved_from)) : "",
    day: d.reserved_from ? dayFmt.format(new Date(d.reserved_from)) : null,
    tables: (d.reserved_tables_ids || []).map((id) => tableNum.get(id)).filter((n) => n != null),
    deposit: depositStatus(r),
    state: r.state,
  };
}

// ----- snapshot לפאנל הקריאה (מחליף את sync.js: תהליך אחד מחזיק את הפרופיל) -----
function normalizeForSnapshot(list, tables) {
  const tableNum = new Map(tables.map((t) => [t._id, t.number]));
  return list
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
        notes: ((d.notes || "") + (d.personal_message ? ` | ${d.personal_message}` : "")).trim(),
        manageUrl: (r.links && r.links.management) || null,
      };
    })
    .filter((r) => r.fromISO);
}
async function pushSnapshot(page, cfg) {
  const [list, tables] = [await getReservations(page), await getTables(page)];
  const snapshot = { generatedAt: Date.now(), reservations: normalizeForSnapshot(list, tables) };
  const res = await fetch(cfg.url, { method: "POST", headers: { "content-type": "application/json", "x-tabit-sync-secret": cfg.secret }, body: JSON.stringify(snapshot) });
  console.log(`[snapshot] ${snapshot.reservations.length} reservations -> ${res.status}`);
}

async function actHealth(page) {
  const status = await apiFetch(page, "GET", "/status");
  const list = await getReservations(page);
  return { ok: true, serverVersion: status.body && status.body.version, reservationsLoaded: list.length };
}
async function actReadDay(page, params) {
  const day = resolveDay(params.day);
  const [list, tables] = [await getReservations(page), await getTables(page)];
  const tableNum = new Map(tables.map((t) => [t._id, t.number]));
  const rows = list
    .filter((r) => r && r.type !== "walked_in" && r.state !== "cancelled")
    .map((r) => mapReservation(r, tableNum))
    .filter((r) => r.day === day)
    .sort((a, b) => (a.time < b.time ? -1 : 1));
  return { day, count: rows.length, reservations: rows };
}
async function actDepositSummary(page, params) {
  const { day, reservations } = await actReadDay(page, params);
  const missing = reservations.filter((r) => r.deposit === "missing");
  const secured = reservations.filter((r) => r.deposit === "secured").length;
  return { day, total: reservations.length, secured, missing: missing.length, missingList: missing.map((r) => ({ id: r.id, name: r.name, seats: r.seats, time: r.time })) };
}
async function actGetDepositLink(page, params) {
  for (let i = 0; i < 4; i++) {
    const list = await getReservations(page);
    const r = list.find((x) => x._id === params.reservationId);
    if (r) {
      const link = r.links && r.links.deposit;
      if (link) return { id: r._id, name: r.reservation_details && r.reservation_details.customer && r.reservation_details.customer.name, deposit_link: link };
    }
    await new Promise((s) => setTimeout(s, 3000));
  }
  return { id: params.reservationId, deposit_link: null, note: "קישור פיקדון עדיין לא נוצר, או ההזמנה לא נמצאה" };
}

async function actCreateReservation(page, params, me) {
  const { name, phone, date, time, seats } = params;
  if (!name || !phone || !date || !time || !seats) throw new Error("חסרים פרטים: שם, טלפון, תאריך, שעה, סועדים");
  const from = ilToUtcISO(date, time);
  const until = new Date(new Date(from).getTime() + 120 * 60000).toISOString();

  // בחר שולחן פנוי בגודל מתאים (כמו שהאפליקציה ממליצה) - להעלאת סיכוי ההצלחה
  const tables = await getTables(page);
  const cand = tables.filter((t) => !t.disabled && (t.seats || 0) >= Number(seats)).sort((a, b) => a.seats - b.seats);
  const avail = cand.find((t) => t.status === "available") || cand[0];
  const tableIds = avail ? [avail._id] : [];

  const localId = Math.random().toString(36).slice(2, 18);
  const body = {
    type: "future_reservation",
    created: new Date().toISOString(),
    created_by: me.id,
    created_by_name: me.name,
    last_modified_by: "",
    standby_reservation: false,
    pending_approval: false,
    block_review: false,
    exclude_from_remind_all: false,
    locale: null,
    reservation_details: {
      reserved_tables_ids: tableIds,
      reserved_tables_locked: false,
      seats_count: Number(seats),
      reserved_from: from,
      reserved_until: until,
      reserved_until_is_estimated: true,
      customer: { name, email: "", phone, notes: "", notes_hq: "", tags: [] },
      preferences: [],
      notes: "",
      personal_message: "",
      tags: [],
      notify_almost_done: false,
      preference: "first_available",
    },
    deposit: { request_cc_details: true, request_cc_details_email: false, cancel_request_cc_details: false },
    request_deposit_payment: false,
    request_advanced_payment: false,
    // חד-פעמית (לא חוזרת)
    recurring_reservation: { interval: { weeks: 0 }, weekdays: [], end_date: null },
    standby_flexible_time: { from: "", to: "" },
    // לא שולחים SMS ללקוח בזמן בדיקות - שולפים את הקישור ומציגים בצ'אט
    send_notification: { event_type: "deposit", by_sms: false, by_email: false },
    local_reservation: true,
    created_by_name_dup: me.name,
    local_id: localId,
  };

  const res = await apiFetch(page, "POST", "/reservations", body);
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`יצירה נכשלה (status ${res.status}): ${JSON.stringify(res.body).slice(0, 300)}`);
  }
  const created = res.body || {};
  const id = created._id;
  const link = await actGetDepositLink(page, { reservationId: id });
  return {
    id,
    name,
    seats: Number(seats),
    day: dayFmt.format(new Date(from)),
    time: timeFmt.format(new Date(from)),
    table: avail ? avail.number : null,
    deposit_link: link.deposit_link,
    note: link.deposit_link ? "נוצר בהצלחה" : "נוצר, אבל קישור הפיקדון עדיין לא זמין - נסה שוב עוד רגע",
  };
}

async function run(page, cmd, me) {
  switch (cmd.action) {
    case "health": return actHealth(page);
    case "read_day": return actReadDay(page, cmd.params || {});
    case "deposit_summary": return actDepositSummary(page, cmd.params || {});
    case "get_deposit_link": return actGetDepositLink(page, cmd.params || {});
    case "create_reservation": return actCreateReservation(page, cmd.params || {}, me);
    default: throw new Error(`פעולה לא מוכרת: ${cmd.action}`);
  }
}

(async () => {
  const cfg = loadConfig();
  if (!cfg.agentUrl || !cfg.secret) { console.error("חסר TABIT_SYNC_URL / TABIT_SYNC_SECRET (או sync-config.json)"); process.exit(1); }
  console.log("agent polling:", cfg.agentUrl);

  try { for (const f of fs.readdirSync(PROFILE_DIR)) if (f.startsWith("Singleton")) try { fs.unlinkSync(path.join(PROFILE_DIR, f)); } catch (_) {} } catch (_) {}
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1280, height: 800 } });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3000);

  // מי אני (created_by) - לשדות היצירה
  let me = { id: null, name: "בדיקה" };
  try {
    const cur = await apiFetch(page, "GET", `/users/current?organization=${ORG_ID}`);
    if (cur.status === 200 && cur.body) me = { id: cur.body._id, name: [cur.body.firstName, cur.body.lastName].filter(Boolean).join(" ") || "בדיקה" };
  } catch (_) {}
  console.log("ready as:", me.name, me.id);

  const SNAPSHOT_MS = 5 * 60 * 1000;
  let lastSnap = 0;

  for (;;) {
    // snapshot תקופתי לפאנל הקריאה (מחליף את משימת sync המתוזמנת)
    if (Date.now() - lastSnap > SNAPSHOT_MS) {
      lastSnap = Date.now();
      try { await pushSnapshot(page, cfg); } catch (e) { console.error("[snapshot] failed:", e.message); }
    }

    let cmd = null;
    try {
      const res = await fetch(cfg.agentUrl, { headers: { "x-tabit-sync-secret": cfg.secret } });
      if (res.ok) cmd = (await res.json()).command;
    } catch (_) {}
    if (!cmd) { await new Promise((s) => setTimeout(s, POLL_MS)); continue; }

    console.log(`> ${cmd.action}`, JSON.stringify(cmd.params || {}));
    let status = "done", result = null, error = null;
    try { result = await run(page, cmd, me); }
    catch (e) { status = "error"; error = e instanceof Error ? e.message : String(e); console.error("  error:", error); }

    try {
      await fetch(cfg.agentUrl, {
        method: "POST",
        headers: { "content-type": "application/json", "x-tabit-sync-secret": cfg.secret },
        body: JSON.stringify({ id: cmd.id, status, result, error }),
      });
      console.log(`  -> ${status}`);
    } catch (e) { console.error("  failed to post result:", e.message); }
  }
})();
