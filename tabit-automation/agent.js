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
  // covers מחושב בקוד (דטרמיניסטי) - הבוט לא מחבר בעצמו (מקור אי-דיוקים)
  const covers = rows.reduce((s, r) => s + (r.seats || 0), 0);
  return { day, count: rows.length, covers, reservations: rows };
}
async function actDepositSummary(page, params) {
  const { day, covers, reservations } = await actReadDay(page, params);
  const missing = reservations.filter((r) => r.deposit === "missing");
  const secured = reservations.filter((r) => r.deposit === "secured").length;
  return { day, total: reservations.length, covers, secured, missing: missing.length, missingList: missing.map((r) => ({ id: r.id, name: r.name, seats: r.seats, time: r.time })) };
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

/**
 * שיוך שולחן חכם ומודע-זמינות: מחזיר שולחן בודד (הקטן שמתאים) או צירוף
 * שולחנות לקבוצה גדולה - אך ורק מתוך שולחנות שפנויים בחלון הזמן הזה (לא
 * תפוסים ע"י הזמנה קיימת חופפת). כך לעולם לא "דורסים" הזמנה קיימת.
 */
function pickTables(tables, allReservations, fromISO, untilISO, party) {
  const fromT = new Date(fromISO).getTime();
  const untilT = new Date(untilISO).getTime();
  const occupied = new Set();
  for (const r of allReservations) {
    const d = r.reservation_details || {};
    if (!d.reserved_from || r.state === "cancelled") continue;
    const rf = new Date(d.reserved_from).getTime();
    const ru = d.reserved_until ? new Date(d.reserved_until).getTime() : rf + 120 * 60000;
    if (rf < untilT && ru > fromT) (d.reserved_tables_ids || []).forEach((id) => occupied.add(id));
  }
  const free = tables.filter((t) => !t.disabled && !occupied.has(t._id));
  // שולחן בודד: הקטן ביותר שמכיל את הקבוצה
  const singles = free.filter((t) => (t.seats || 0) >= party).sort((a, b) => a.seats - b.seats);
  if (singles.length) return { ids: [singles[0]._id], numbers: [singles[0].number] };
  // צירוף לקבוצה גדולה: מהגדול לקטן, מאותו אזור אם אפשר, עד שמגיעים לגודל
  const byArea = new Map();
  for (const t of free) { const a = (t.area && t.area.name) || ""; if (!byArea.has(a)) byArea.set(a, []); byArea.get(a).push(t); }
  let best = null;
  for (const group of [...byArea.values(), free]) {
    const sorted = [...group].sort((a, b) => b.seats - a.seats);
    const chosen = []; let sum = 0;
    for (const t of sorted) { chosen.push(t); sum += t.seats || 0; if (sum >= party) break; }
    if (sum >= party && (!best || chosen.length < best.chosen.length)) best = { chosen, sum };
  }
  if (best) return { ids: best.chosen.map((t) => t._id), numbers: best.chosen.map((t) => t.number) };
  return { ids: [], numbers: [] };
}

async function actCreateReservation(page, params, me) {
  const { name, phone, date, time, seats, send_deposit_link } = params;
  if (!name || !phone || !date || !time || !seats) throw new Error("חסרים פרטים: שם, טלפון, תאריך, שעה, סועדים");
  const from = ilToUtcISO(date, time);
  const until = new Date(new Date(from).getTime() + 120 * 60000).toISOString();

  // שיוך שולחן חכם מתוך השולחנות הפנויים בחלון הזמן הזה
  const [tables, allRes] = [await getTables(page), await getReservations(page)];
  const picked = pickTables(tables, allRes, from, until, Number(seats));
  const tableIds = picked.ids;

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
    // שליחת SMS ללקוח רק אם התבקש במפורש (send_deposit_link). אחרת שולפים
    // את הקישור ומציגים בצ'אט בלי להטריד את הלקוח.
    send_notification: { event_type: "deposit", by_sms: !!send_deposit_link, by_email: false },
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
    tables: picked.numbers,
    tables_note: picked.numbers.length ? `שולחן ${picked.numbers.join(", ")}` : "לא נמצא שולחן פנוי מתאים - נוצר בלי שולחן",
    deposit_link: link.deposit_link,
    deposit_sms_sent: !!send_deposit_link,
    note: link.deposit_link
      ? (send_deposit_link ? "נוצר, וקישור הפיקדון נשלח ללקוח ב-SMS" : "נוצר. הקישור לא נשלח ללקוח (לא התבקש) - הנה הוא")
      : "נוצר, אבל קישור הפיקדון עדיין לא זמין - נסה שוב עוד רגע",
  };
}

// ===== קבוצה א': קריאה וניתוח מתקדם =====

async function getArchived(page, fromISO) {
  const q = fromISO ? `?from=${encodeURIComponent(fromISO)}&tgmv=${Date.now()}` : `?tgmv=${Date.now()}`;
  const r = await apiFetch(page, "GET", `/reservations-archived${q}`);
  if (r.status !== 200 || !Array.isArray(r.body)) throw new Error(`קריאת ארכיון נכשלה (status ${r.status}) - ייתכן שה-session פג`);
  return r.body;
}

// ביטול אמיתי (לא ניקוי-מערכת של הזמנה זמנית שפגה)
const REAL_CANCEL = new Set(["customer_cancelled", "cancelled", "אחר"]);

function sourceLabel(r) {
  if (r.type === "walked_in") return "הגעה מהרחוב";
  const s = r.online_booking_source_client && r.online_booking_source_client.name;
  if (s === "tabit-web") return "אונליין (אתר)";
  if (s === "tabit-google-reserve") return "גוגל";
  if (r.online_booking) return "אונליין";
  return "טלפון / צוות";
}

const digitsOnly = (p) => (p || "").replace(/\D/g, "");
function samePhone(a, b) {
  const A = digitsOnly(a), B = digitsOnly(b);
  if (A.length < 9 || B.length < 9) return false;
  return A.slice(-9) === B.slice(-9);
}

async function actNoShowSummary(page, params) {
  const days = Number(params.days) || 30;
  const fromISO = new Date(Date.now() - days * 86400000).toISOString();
  const list = await getArchived(page, fromISO);
  let noShow = 0, cancelled = 0, completed = 0;
  const byPhone = new Map();
  for (const r of list) {
    const reason = r.archived_reason || "";
    if (reason === "idle-temp-reservation") continue;
    if (reason === "no_show") {
      noShow++;
      const c = r.reservation_details && r.reservation_details.customer;
      if (c && c.phone) byPhone.set(c.phone, { name: c.name || "", n: (byPhone.get(c.phone) ? byPhone.get(c.phone).n : 0) + 1 });
    } else if (REAL_CANCEL.has(reason)) cancelled++;
    else completed++;
  }
  const total = noShow + cancelled + completed;
  const repeat = [...byPhone.entries()].filter(([, v]) => v.n >= 2).map(([phone, v]) => ({ phone, name: v.name, no_shows: v.n }));
  return { period_days: days, total, no_show: noShow, cancelled, completed, no_show_rate_pct: total ? Math.round((noShow / total) * 1000) / 10 : 0, repeat_no_show_customers: repeat };
}

async function actBookingSources(page, params) {
  const days = Number(params.days) || 30;
  const fromISO = new Date(Date.now() - days * 86400000).toISOString();
  const list = await getArchived(page, fromISO);
  const counts = {};
  for (const r of list) {
    if (r.archived_reason === "idle-temp-reservation") continue;
    const l = sourceLabel(r);
    counts[l] = (counts[l] || 0) + 1;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const breakdown = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([source, count]) => ({ source, count, pct: total ? Math.round((count / total) * 1000) / 10 : 0 }));
  return { period_days: days, total, breakdown };
}

const TABLE_STATUS_HE = { available: "פנוי", occupied: "תפוס", reserved: "שמור", dirty: "מלוכלך", seated: "תפוס", cleaning: "בניקוי" };
async function actTablesStatus(page) {
  const tables = await getTables(page);
  const active = tables.filter((t) => !t.disabled);
  const counts = {};
  let seats = 0;
  for (const t of active) { const s = t.status || "?"; counts[s] = (counts[s] || 0) + 1; seats += t.seats || 0; }
  const by_status = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([status, count]) => ({ status, label: TABLE_STATUS_HE[status] || status, count }));
  return { total_tables: active.length, total_seats: seats, by_status };
}

async function actCustomerLookup(page, params) {
  const { phone, name } = params;
  if (!phone && !name) throw new Error("צריך טלפון או שם לחיפוש");
  const fromISO = new Date(Date.now() - 365 * 86400000).toISOString();
  const [upcoming, archived, tables] = [await getReservations(page), await getArchived(page, fromISO), await getTables(page)];
  const tableNum = new Map(tables.map((t) => [t._id, t.number]));
  const match = (r) => {
    const c = (r.reservation_details && r.reservation_details.customer) || {};
    if (phone && samePhone(c.phone, phone)) return true;
    if (name && c.name && c.name.includes(name)) return true;
    return false;
  };
  const up = upcoming.filter((r) => r.type !== "walked_in" && r.state !== "cancelled").filter(match).map((r) => mapReservation(r, tableNum));
  const past = archived.filter(match);
  const visits = past.filter((r) => !r.archived_reason || r.archived_reason === "").length;
  const noShows = past.filter((r) => r.archived_reason === "no_show").length;
  const cancels = past.filter((r) => REAL_CANCEL.has(r.archived_reason)).length;
  const found = up[0] || past[0];
  const c = found && found.reservation_details && found.reservation_details.customer;
  return {
    name: (found && (found.name || (c && c.name))) || name || "",
    phone: (c && c.phone) || phone || "",
    upcoming: up.map((r) => ({ day: r.day, time: r.time, seats: r.seats, tables: r.tables, deposit: r.deposit })),
    past_visits: visits,
    no_shows: noShows,
    cancellations: cancels,
  };
}

async function actCheckAvailability(page, params) {
  const { date, time, seats } = params;
  if (!date || !time || !seats) throw new Error("צריך תאריך (YYYY-MM-DD), שעה (HH:MM) ומספר סועדים");
  const from = ilToUtcISO(date, time);
  const until = new Date(new Date(from).getTime() + 120 * 60000).toISOString();
  const [tables, allRes] = [await getTables(page), await getReservations(page)];
  const picked = pickTables(tables, allRes, from, until, Number(seats));
  return {
    date, time, seats: Number(seats),
    available: picked.ids.length > 0,
    tables: picked.numbers,
    note: picked.ids.length ? `יש מקום: שולחן ${picked.numbers.join(", ")}` : "אין שולחן פנוי מתאים בשעה הזאת",
  };
}

async function run(page, cmd, me) {
  switch (cmd.action) {
    case "health": return actHealth(page);
    case "read_day": return actReadDay(page, cmd.params || {});
    case "deposit_summary": return actDepositSummary(page, cmd.params || {});
    case "get_deposit_link": return actGetDepositLink(page, cmd.params || {});
    case "create_reservation": return actCreateReservation(page, cmd.params || {}, me);
    case "no_show_summary": return actNoShowSummary(page, cmd.params || {});
    case "booking_sources": return actBookingSources(page, cmd.params || {});
    case "tables_status": return actTablesStatus(page);
    case "customer_lookup": return actCustomerLookup(page, cmd.params || {});
    case "check_availability": return actCheckAvailability(page, cmd.params || {});
    default: throw new Error(`פעולה לא מוכרת: ${cmd.action}`);
  }
}

function cleanLocks() {
  try { for (const f of fs.readdirSync(PROFILE_DIR)) if (f.startsWith("Singleton")) try { fs.unlinkSync(path.join(PROFILE_DIR, f)); } catch (_) {} } catch (_) {}
}

// נעילת מופע-יחיד: מונע שני סוכנים על אותו פרופיל (הסיבה ל"Target crashed").
const LOCK = path.join(__dirname, "agent.lock");
function anotherAgentAlive() {
  try { const t = Number(fs.readFileSync(LOCK, "utf8")); return Number.isFinite(t) && Date.now() - t < 15000; } catch (_) { return false; }
}
function touchLock() { try { fs.writeFileSync(LOCK, String(Date.now())); } catch (_) {} }

const isCrash = (m) => /crash|target closed|target crashed|has been closed|session closed|disconnected|execution context/i.test(m || "");

async function launchBrowser() {
  cleanLocks();
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1280, height: 800 } });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3000);
  let me = { id: null, name: "בדיקה" };
  try {
    const cur = await apiFetch(page, "GET", `/users/current?organization=${ORG_ID}`);
    if (cur.status === 200 && cur.body) me = { id: cur.body._id, name: [cur.body.firstName, cur.body.lastName].filter(Boolean).join(" ") || "בדיקה" };
  } catch (_) {}
  console.log("ready as:", me.name, me.id);
  return { ctx, page, me };
}

(async () => {
  const cfg = loadConfig();
  if (!cfg.agentUrl || !cfg.secret) { console.error("חסר TABIT_SYNC_URL / TABIT_SYNC_SECRET (או sync-config.json)"); process.exit(1); }
  if (anotherAgentAlive()) { console.error("סוכן אחר כבר רץ (agent.lock טרי). סגור אותו קודם. יוצא."); process.exit(1); }
  console.log("agent polling:", cfg.agentUrl);

  let b = await launchBrowser();
  async function recover(e) {
    console.error("  browser crashed - relaunching:", e && e.message);
    try { await b.ctx.close(); } catch (_) {}
    await new Promise((s) => setTimeout(s, 1500));
    b = await launchBrowser();
  }

  const SNAPSHOT_MS = 5 * 60 * 1000;
  let lastSnap = 0;

  for (;;) {
    touchLock();
    if (Date.now() - lastSnap > SNAPSHOT_MS) {
      lastSnap = Date.now();
      try { await pushSnapshot(b.page, cfg); } catch (e) { if (isCrash(e.message)) await recover(e); else console.error("[snapshot] failed:", e.message); }
    }

    let cmd = null;
    try {
      const res = await fetch(cfg.agentUrl, { headers: { "x-tabit-sync-secret": cfg.secret } });
      if (res.ok) cmd = (await res.json()).command;
    } catch (_) {}
    if (!cmd) { await new Promise((s) => setTimeout(s, POLL_MS)); continue; }

    console.log(`> ${cmd.action}`, JSON.stringify(cmd.params || {}));
    let status = "done", result = null, error = null;
    try { result = await run(b.page, cmd, b.me); }
    catch (e) {
      status = "error"; error = e instanceof Error ? e.message : String(e); console.error("  error:", error);
      if (isCrash(error)) await recover(e);
    }

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
