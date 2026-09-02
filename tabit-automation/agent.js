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

// קריאה גולמית מול ה-API (בתוך הדפדפן המאומת), בלי טיפול ב-401.
async function apiFetchRaw(page, method, apiPath, bodyObj) {
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

// ----- התחברות-מחדש אוטומטית (self-heal) -----
// כשמקבלים 401, מתחברים מחדש לבד עם POST /sessions (מזהה משתמש + קוד גישה
// ששמורים מקומית ב-agent-credentials.json). המכשיר כבר מאושר, אז לא צריך
// אימייל/סיסמה. אחרי התחברות מחדש - חוזרים על הקריאה המקורית.
let CREDS = null;
function loadCreds() {
  try { CREDS = JSON.parse(fs.readFileSync(path.join(__dirname, "agent-credentials.json"), "utf8")); }
  catch (_) { CREDS = null; }
}
async function reauth(page) {
  loadCreds(); // תמיד לקרוא את הקובץ העדכני (אם הוספת passcode תוך כדי ריצה)
  if (!CREDS || !CREDS.userId || CREDS.passcode == null || CREDS.passcode === "") {
    console.log("[reauth] אין passcode ב-agent-credentials.json - לא ניתן להתחבר מחדש לבד");
    return false;
  }
  const body = { id: CREDS.userId, passcode: String(CREDS.passcode), supportUser: false, organization: ORG_ID, device_name: HEADERS["x-tg-device-name"] };
  try { await apiFetchRaw(page, "DELETE", "/sessions", { clearAllSites: false }); } catch (_) {}
  const r = await apiFetchRaw(page, "POST", "/sessions", body);
  const ok = r.status === 200 && r.body && r.body.token;
  console.log(ok ? "[reauth] התחברות מחדש הצליחה ✓" : `[reauth] נכשל (status ${r.status})`);
  return ok;
}

async function apiFetch(page, method, apiPath, bodyObj) {
  let r = await apiFetchRaw(page, method, apiPath, bodyObj);
  if (r.status === 401 && apiPath !== "/sessions") {
    console.log("[reauth] 401 - מנסה להתחבר מחדש לבד…");
    if (await reauth(page)) r = await apiFetchRaw(page, method, apiPath, bodyObj);
  }
  return r;
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
// סועדים + מספר הזמנות ליום, אופציונלית בטווח שעות (למשל ערב = from 18:00).
// הכל מחושב בקוד (דטרמיניסטי) - הבוט לא מסכם בעצמו.
async function actCoversSummary(page, params) {
  const { day, reservations } = await actReadDay(page, { day: params.day });
  const from = params.from || "00:00";
  const to = params.to || "23:59";
  const win = reservations.filter((r) => r.time >= from && r.time <= to);
  const covers = win.reduce((s, r) => s + (r.seats || 0), 0);
  return {
    day, from, to,
    count: win.length,
    covers,
    reservations: win.map((r) => ({ time: r.time, name: r.name, seats: r.seats, deposit: r.deposit })),
  };
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

// ===== הגדרת אזורים לפי החלוקה האמיתית של קוואלי (לא לפי area.name של טאביט) =====
// "בחוץ" = הרשימה המפורשת הזאת (כולל "מול המסך"). כל השאר = "בפנים".
// 72-79 נעולים כרגע (עד עדכון) - לא משבצים אליהם.
// ⚠️ הצירופים (אילו שולחנות מתחברים) עדיין לא הוגדרו - צריך לעבור עם איש צוות.
const OUTSIDE_NUMS = new Set([70, 69, 68, 67, 66, 65, 64, 63, 62, 61, 60, 59, 58, 57, 56, 55, 54, 53, 52, 80, 81, 82, 83, 5, 6, 7, 8, 49, 50, 51]);
const LOCKED_NUMS = new Set([72, 73, 74, 75, 76, 77, 78, 79]);
const isOutside = (t) => OUTSIDE_NUMS.has(t.number);
const isLockedTable = (t) => LOCKED_NUMS.has(t.number);

// מרחק פיזי בין שני שולחנות לפי מיקומם על המפה (location.x/y).
function dist(a, b) {
  const ax = a.location && a.location.x, ay = a.location && a.location.y;
  const bx = b.location && b.location.x, by = b.location && b.location.y;
  if (ax == null || bx == null) return 1e6;
  return Math.hypot(ax - bx, ay - by);
}
// צירוף מודע-צמידות: מכל שולחן-זרע מגדילים אשכול לפי השכן הקרוב ביותר עד שמגיעים
// לגודל הקבוצה, ובוחרים את האשכול עם הכי מעט עודף מקומות ואז הכי קומפקטי.
// ⚠️ צמידות לפי מיקום היא היוריסטיקה טובה אבל לא מושלמת (יכול להיות מעבר בין
// שולחנות קרובים) - צריך אימות מול הצוות ואפשר להוסיף חריגים.
function comboByProximity(free, party) {
  let best = null;
  for (const seed of free) {
    const cluster = [seed];
    let sum = seed.seats || 0;
    const rest = free.filter((t) => t !== seed);
    while (sum < party && rest.length) {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < rest.length; i++) {
        let d = Infinity;
        for (const c of cluster) d = Math.min(d, dist(c, rest[i]));
        if (d < bd) { bd = d; bi = i; }
      }
      const t = rest.splice(bi, 1)[0];
      cluster.push(t);
      sum += t.seats || 0;
    }
    if (sum >= party) {
      const excess = sum - party;
      let spread = 0;
      for (let i = 0; i < cluster.length; i++) for (let j = i + 1; j < cluster.length; j++) spread = Math.max(spread, dist(cluster[i], cluster[j]));
      if (!best || excess < best.excess || (excess === best.excess && spread < best.spread)) best = { cluster, excess, spread };
    }
  }
  return best ? best.cluster : null;
}

/**
 * שיוך שולחן מודע-זמינות: מחזיר שולחן בודד (הקטן שמתאים) או צירוף שולחנות
 * צמודים, אך ורק מתוך שולחנות פנויים בחלון הזמן ובאזור המבוקש (פנים/חוץ),
 * ולא נעולים. seatingPref: "inside" | "outside" | null (הכל).
 */
function pickTables(tables, allReservations, fromISO, untilISO, party, seatingPref) {
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
  let free = tables.filter((t) => !t.disabled && !isLockedTable(t) && !occupied.has(t._id));
  // הגבלה לאזור מבוקש לפי החלוקה של קוואלי
  if (seatingPref === "outside") free = free.filter((t) => isOutside(t));
  else if (seatingPref === "inside") free = free.filter((t) => !isOutside(t));
  // שולחן בודד: הקטן ביותר שמכיל את הקבוצה
  const singles = free.filter((t) => (t.seats || 0) >= party).sort((a, b) => a.seats - b.seats);
  if (singles.length) return { ids: [singles[0]._id], numbers: [singles[0].number] };
  // צירוף לקבוצה גדולה: אשכול של שולחנות צמודים פיזית (לפי מיקום), עם התאמה
  // הדוקה לגודל. כך 10 סועדים יקבלו שילוב קומפקטי של שולחנות סמוכים.
  const combo = comboByProximity(free, party);
  if (combo) return { ids: combo.map((t) => t._id), numbers: combo.map((t) => t.number) };
  return { ids: [], numbers: [] };
}

async function actCreateReservation(page, params, me) {
  const { name, phone, date, time, seats, send_deposit_link, seating } = params;
  if (!name || !phone || !date || !time || !seats) throw new Error("חסרים פרטים: שם, טלפון, תאריך, שעה, סועדים");
  const from = ilToUtcISO(date, time);
  const until = new Date(new Date(from).getTime() + 120 * 60000).toISOString();

  // אזור: פנים / חוץ (לפי החלוקה של קוואלי). "בר" לא נתמך כרגע.
  let seatingPref = null, areaLabel = null;
  if (seating === "inside") { seatingPref = "inside"; areaLabel = "פנים"; }
  else if (seating === "outside") { seatingPref = "outside"; areaLabel = "חוץ"; }

  // שיוך שולחן מתוך השולחנות הפנויים בחלון הזמן ובאזור המבוקש
  const [tables, allRes] = [await getTables(page), await getReservations(page)];
  const picked = pickTables(tables, allRes, from, until, Number(seats), seatingPref);
  const tableIds = picked.ids;
  // אם התבקש אזור ואין בו מקום - לא יוצרים בלי שולחן/באזור שגוי, מדווחים
  if (seatingPref && tableIds.length === 0) throw new Error(`אין שולחן פנוי ב${areaLabel} בשעה ${time} - לא יצרתי את ההזמנה`);
  const firstTbl = tables.find((t) => t._id === (tableIds[0] || ""));
  const prefVal = seatingPref ? ((firstTbl && firstTbl.area && firstTbl.area.name) || "first_available") : "first_available";

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
      preference: prefVal,
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
    area: areaLabel,
    tables: picked.numbers,
    tables_note: picked.numbers.length
      ? `שולחן ${picked.numbers.join(", ")}${areaLabel ? ` (${areaLabel})` : ""}`
      : (areaLabel ? `לא נמצא שולחן פנוי ב${areaLabel} - נוצר בלי שולחן` : "לא נמצא שולחן פנוי מתאים - נוצר בלי שולחן"),
    deposit_link: link.deposit_link,
    deposit_sms_sent: !!send_deposit_link,
    note: link.deposit_link
      ? (send_deposit_link ? "נוצר, וקישור הפיקדון נשלח ללקוח ב-SMS" : "נוצר. הקישור לא נשלח ללקוח (לא התבקש) - הנה הוא")
      : "נוצר, אבל קישור הפיקדון עדיין לא זמין - נסה שוב עוד רגע",
  };
}

// ===== קבוצה א': קריאה וניתוח מתקדם =====

// הארכיון של טאביט דוחה טווח 'from' רחוק מדי (400 - האפליקציה מבקשת רק מתחילת
// היום). מנסים את הטווח המבוקש ואז חלונות קצרים יותר עד שמתקבל 200. מחזיר את
// הפריטים ואת הטווח שבאמת התקבל, כדי שהכלים ידווחו כיסוי אמיתי.
async function getArchived(page, requestedFromISO) {
  const now = Date.now();
  const startOfTodayUTC = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.toISOString(); };
  const cands = [];
  if (requestedFromISO) cands.push(requestedFromISO);
  for (const days of [14, 7, 3, 1]) cands.push(new Date(now - days * 86400000).toISOString());
  cands.push(startOfTodayUTC());
  let last = null;
  for (const iso of cands) {
    const r = await apiFetch(page, "GET", `/reservations-archived?from=${encodeURIComponent(iso)}&tgmv=${Date.now()}`);
    last = r;
    if (r.status === 200 && Array.isArray(r.body)) return { items: r.body, from: iso };
    if (r.status === 401) throw new Error("ה-session מול טאביט פג - הרץ login.js");
    // 400/אחר: ננסה חלון קצר יותר
  }
  throw new Error(`קריאת ארכיון נכשלה (status ${last && last.status})`);
}
function coveredDays(fromISO) { return Math.max(1, Math.round((Date.now() - new Date(fromISO).getTime()) / 86400000)); }

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
  const requested = new Date(Date.now() - days * 86400000).toISOString();
  const { items: list, from } = await getArchived(page, requested);
  const covered = coveredDays(from);
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
  return {
    period_days_requested: days,
    period_days_covered: covered,
    coverage_note: covered < days ? "טאביט החזיר חלון ארכיון קצר מהמבוקש; המספרים מכסים את הימים שהתקבלו בפועל" : undefined,
    total, no_show: noShow, cancelled, completed,
    no_show_rate_pct: total ? Math.round((noShow / total) * 1000) / 10 : 0,
    repeat_no_show_customers: repeat,
  };
}

async function actBookingSources(page, params) {
  const days = Number(params.days) || 30;
  const requested = new Date(Date.now() - days * 86400000).toISOString();
  const { items: list, from } = await getArchived(page, requested);
  const covered = coveredDays(from);
  const counts = {};
  for (const r of list) {
    if (r.archived_reason === "idle-temp-reservation") continue;
    const l = sourceLabel(r);
    counts[l] = (counts[l] || 0) + 1;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const breakdown = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([source, count]) => ({ source, count, pct: total ? Math.round((count / total) * 1000) / 10 : 0 }));
  return {
    period_days_requested: days,
    period_days_covered: covered,
    coverage_note: covered < days ? "טאביט החזיר חלון ארכיון קצר מהמבוקש" : undefined,
    total, breakdown,
  };
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
  const [upcoming, tables] = [await getReservations(page), await getTables(page)];
  const tableNum = new Map(tables.map((t) => [t._id, t.number]));
  const match = (r) => {
    const c = (r.reservation_details && r.reservation_details.customer) || {};
    if (phone && samePhone(c.phone, phone)) return true;
    if (name && c.name && c.name.includes(name)) return true;
    return false;
  };
  const upRes = upcoming.filter((r) => r.type !== "walked_in" && r.state !== "cancelled").filter(match);
  const up = upRes.map((r) => mapReservation(r, tableNum));

  // היסטוריית עבר - לא קריטית. אם הארכיון לא זמין, מחזירים בכל זאת את ההזמנות
  // הקרובות (זו התשובה העיקרית ל"יש לו הזמנה?").
  let past_visits = null, no_shows = null, cancellations = null, history_note;
  try {
    const { items: archived } = await getArchived(page, new Date(Date.now() - 90 * 86400000).toISOString());
    const past = archived.filter(match);
    past_visits = past.filter((r) => !r.archived_reason || r.archived_reason === "").length;
    no_shows = past.filter((r) => r.archived_reason === "no_show").length;
    cancellations = past.filter((r) => REAL_CANCEL.has(r.archived_reason)).length;
  } catch (_) { history_note = "היסטוריית עבר לא זמינה כרגע (הארכיון לא הגיב) - ההזמנות הקרובות למטה מדויקות"; }

  const c = upRes[0] && upRes[0].reservation_details && upRes[0].reservation_details.customer;
  return {
    name: (c && c.name) || name || "",
    phone: (c && c.phone) || phone || "",
    has_upcoming: up.length > 0,
    upcoming: up.map((r) => ({ id: r.id, day: r.day, time: r.time, seats: r.seats, tables: r.tables, deposit: r.deposit })),
    past_visits, no_shows, cancellations,
    ...(history_note ? { history_note } : {}),
  };
}

async function actCheckAvailability(page, params) {
  const { date, time, seats, seating } = params;
  if (!date || !time || !seats) throw new Error("צריך תאריך (YYYY-MM-DD), שעה (HH:MM) ומספר סועדים");
  const from = ilToUtcISO(date, time);
  const until = new Date(new Date(from).getTime() + 120 * 60000).toISOString();
  const seatingPref = seating === "inside" ? "inside" : seating === "outside" ? "outside" : null;
  const [tables, allRes] = [await getTables(page), await getReservations(page)];
  const picked = pickTables(tables, allRes, from, until, Number(seats), seatingPref);
  const areaOfPicked = picked.numbers.length ? (OUTSIDE_NUMS.has(picked.numbers[0]) ? "חוץ" : "פנים") : null;
  const reqAreaHe = seatingPref === "outside" ? "חוץ" : seatingPref === "inside" ? "פנים" : null;
  return {
    date, time, seats: Number(seats),
    requested_area: reqAreaHe || "כל אזור",
    available: picked.ids.length > 0,
    tables: picked.numbers,
    area: areaOfPicked,
    note: picked.ids.length
      ? `יש מקום ב${areaOfPicked}: שולחן ${picked.numbers.join(", ")}`
      : (reqAreaHe ? `אין שולחן פנוי ב${reqAreaHe} בשעה הזאת` : "אין שולחן פנוי מתאים בשעה הזאת"),
  };
}

// ===== שינוי וביטול הזמנות קיימות (כתיבה!) - רק אחרי שהבוט זיהה ואישר =====

function currentAreaOf(r, tables) {
  // אזור לפי החלוקה של קוואלי: אם שולחן משויך ברשימת "חוץ" -> חוץ, אחרת פנים.
  const numById = new Map(tables.map((t) => [t._id, t.number]));
  for (const id of (r.reservation_details && r.reservation_details.reserved_tables_ids) || []) {
    const num = numById.get(id);
    if (num != null) return OUTSIDE_NUMS.has(num) ? "outside" : "inside";
  }
  // אין שולחנות משויכים - ניגזר מ-preference של טאביט
  const pref = r.reservation_details && r.reservation_details.preference;
  if (pref === "inside") return "inside";
  if (pref === "outside" || pref === "screen") return "outside";
  return null;
}
const AREA_HE = { inside: "פנים", outside: "חוץ", screen: "חוץ", bar: "בר" };
function tblNumbers(ids, tables) {
  return (ids || []).map((id) => { const t = tables.find((x) => x._id === id); return t && t.number; }).filter((n) => n != null);
}

async function actModifyReservation(page, params, me) {
  const { reservation_id, seating, date, time, seats } = params;
  if (!reservation_id) throw new Error("צריך reservation_id (זהה קודם את ההזמנה)");
  const [all, tables] = [await getReservations(page), await getTables(page)];
  const r = all.find((x) => x._id === reservation_id);
  if (!r) throw new Error("ההזמנה לא נמצאה - ייתכן שכבר עברה, בוטלה, או שהמזהה שגוי");
  const d = r.reservation_details || {};
  const curAreaName = currentAreaOf(r, tables);
  const before = { seats: d.seats_count, day: dayFmt.format(new Date(d.reserved_from)), time: timeFmt.format(new Date(d.reserved_from)), area: AREA_HE[curAreaName] || curAreaName, tables: tblNumbers(d.reserved_tables_ids, tables) };

  const newSeats = seats != null ? Number(seats) : d.seats_count;
  let seatingPref = curAreaName || null; // "inside" / "outside"
  let areaLabel = before.area;
  if (seating === "inside") { seatingPref = "inside"; areaLabel = AREA_HE.inside; }
  else if (seating === "outside") { seatingPref = "outside"; areaLabel = AREA_HE.outside; }

  const targetDay = date || dayFmt.format(new Date(d.reserved_from));
  const targetTime = time || timeFmt.format(new Date(d.reserved_from));
  const newFrom = ilToUtcISO(targetDay, targetTime);
  const durMs = new Date(d.reserved_until).getTime() - new Date(d.reserved_from).getTime();
  const newUntil = new Date(new Date(newFrom).getTime() + (durMs > 0 ? durMs : 120 * 60000)).toISOString();

  // שיוך מחדש: מתעלמים מההזמנה עצמה בחישוב התפוסה
  const others = all.filter((x) => x._id !== reservation_id);
  const picked = pickTables(tables, others, newFrom, newUntil, newSeats, seatingPref);
  // אם התבקש אזור חדש ואין בו שולחן פנוי - לא מבצעים ולא מדווחים הצלחה
  if (seating && picked.ids.length === 0) {
    throw new Error(`אין שולחן פנוי ב${areaLabel} בשעה ${targetTime} - לא ביצעתי את השינוי`);
  }
  const newTableIds = picked.ids.length ? picked.ids : (d.reserved_tables_ids || []);
  const firstNewTbl = tables.find((t) => t._id === (newTableIds[0] || ""));
  const newPref = seating ? ((firstNewTbl && firstNewTbl.area && firstNewTbl.area.name) || d.preference || "first_available") : (d.preference || "first_available");

  const body = {
    last_modified_by: me.id, last_modified_by_name: me.name,
    standby_reservation: r.standby_reservation || false, pending_approval: r.pending_approval || false, online_booking: r.online_booking || false,
    reservation_details: {
      ...d,
      reserved_tables_ids: newTableIds,
      seats_count: newSeats,
      reserved_from: newFrom,
      reserved_until: newUntil,
      preference: newPref,
      previous_reserved_from: d.reserved_from,
      previous_reserved_until: d.reserved_until,
    },
    locale: r.locale || null, block_review: r.block_review || false, exclude_from_remind_all: r.exclude_from_remind_all || false,
    hotel_guests_ids: r.hotel_guests_ids || [],
    deposit: { request_cc_details: false, request_cc_details_email: false, cancel_request_cc_details: false },
    deposit_removed: false, advanced_payment_removed: false,
    standby_flexible_time: r.standby_flexible_time || { from: "", to: "" },
    failure_system_notification: { type: "reservation-update-failed", local: true },
  };
  const res = await apiFetch(page, "PUT", `/reservations/${reservation_id}`, body);
  if (res.status !== 200 && res.status !== 201) throw new Error(`עדכון נכשל (status ${res.status}): ${JSON.stringify(res.body).slice(0, 200)}`);

  // אימות אמיתי: קוראים מחדש מטאביט ובונים "אחרי" מהנתונים בפועל (לא ממה שביקשנו)
  const fresh = await getReservations(page);
  const vr = fresh.find((x) => x._id === reservation_id);
  if (!vr) throw new Error("השינוי נשלח אך לא הצלחתי לאמת - ההזמנה לא נמצאה בקריאה חוזרת");
  const vd = vr.reservation_details || {};
  const vArea = currentAreaOf(vr, tables);
  const after = { seats: vd.seats_count, day: dayFmt.format(new Date(vd.reserved_from)), time: timeFmt.format(new Date(vd.reserved_from)), area: AREA_HE[vArea] || vArea, tables: tblNumbers(vd.reserved_tables_ids, tables) };
  const changed = JSON.stringify(before) !== JSON.stringify(after);
  return {
    id: reservation_id,
    name: d.customer && d.customer.name,
    before, after,
    verified_changed: changed,
    note: changed ? "השינוי אומת מול טאביט ✓" : "אזהרה: טאביט קיבל את הבקשה אך ההזמנה לא השתנתה בפועל - אל תדווח שהצליח",
  };
}

async function actCancelReservation(page, params) {
  const { reservation_id } = params;
  if (!reservation_id) throw new Error("צריך reservation_id (זהה קודם את ההזמנה)");
  const all = await getReservations(page);
  const r = all.find((x) => x._id === reservation_id);
  const d = r && r.reservation_details;
  const name = d && d.customer && d.customer.name;
  const body = { reason: "cancelled", send_notification: { event_type: "deleted", send_local_review_request: false }, refund: false };
  const res = await apiFetch(page, "DELETE", `/reservations/${reservation_id}`, body);
  if (res.status !== 200 && res.status !== 201) throw new Error(`ביטול נכשל (status ${res.status}): ${JSON.stringify(res.body).slice(0, 200)}`);
  return {
    id: reservation_id, name, cancelled: true,
    was: d ? { seats: d.seats_count, day: dayFmt.format(new Date(d.reserved_from)), time: timeFmt.format(new Date(d.reserved_from)) } : null,
    archived_reason: (res.body && res.body.archived_reason) || "cancelled",
  };
}

async function run(page, cmd, me) {
  switch (cmd.action) {
    case "health": return actHealth(page);
    case "read_day": return actReadDay(page, cmd.params || {});
    case "covers_summary": return actCoversSummary(page, cmd.params || {});
    case "deposit_summary": return actDepositSummary(page, cmd.params || {});
    case "get_deposit_link": return actGetDepositLink(page, cmd.params || {});
    case "create_reservation": return actCreateReservation(page, cmd.params || {}, me);
    case "no_show_summary": return actNoShowSummary(page, cmd.params || {});
    case "booking_sources": return actBookingSources(page, cmd.params || {});
    case "tables_status": return actTablesStatus(page);
    case "customer_lookup": return actCustomerLookup(page, cmd.params || {});
    case "check_availability": return actCheckAvailability(page, cmd.params || {});
    case "modify_reservation": return actModifyReservation(page, cmd.params || {}, me);
    case "cancel_reservation": return actCancelReservation(page, cmd.params || {});
    default: throw new Error(`פעולה לא מוכרת: ${cmd.action}`);
  }
}

function cleanLocks() {
  try { for (const f of fs.readdirSync(PROFILE_DIR)) if (f.startsWith("Singleton")) try { fs.unlinkSync(path.join(PROFILE_DIR, f)); } catch (_) {} } catch (_) {}
}

// נעילת מופע-יחיד: מונע שני סוכנים על אותו פרופיל (הסיבה ל"Target crashed").
// בודקת אם התהליך שרשום בנעילה *באמת חי* (לפי PID), לא רק לפי זמן - כך
// שסגירה ופתיחה מיד של החלון עובדות (התהליך הישן מת -> הנעילה לא חוסמת).
const LOCK = path.join(__dirname, "agent.lock");
function pidAlive(pid) {
  if (!pid || pid === process.pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}
function anotherAgentAlive() {
  let l;
  try { l = JSON.parse(fs.readFileSync(LOCK, "utf8")); } catch (_) { return false; }
  if (l && typeof l === "object") return pidAlive(l.pid);
  return false;
}
function touchLock() { try { fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, ts: Date.now() })); } catch (_) {} }

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
  // מילוי אוטומטי של userId בקובץ ה-credentials (כך שאתה צריך למלא רק passcode)
  try {
    if (me.id && CREDS && CREDS.userId !== me.id) {
      CREDS.userId = me.id;
      CREDS.name = me.name;
      fs.writeFileSync(path.join(__dirname, "agent-credentials.json"), JSON.stringify(CREDS, null, 2));
      console.log("[reauth] userId עודכן אוטומטית בקובץ ה-credentials");
    }
  } catch (_) {}
  return { ctx, page, me };
}

(async () => {
  const cfg = loadConfig();
  if (!cfg.agentUrl || !cfg.secret) { console.error("חסר TABIT_SYNC_URL / TABIT_SYNC_SECRET (או sync-config.json)"); process.exit(1); }
  if (anotherAgentAlive()) { console.error("סוכן אחר כבר רץ (agent.lock טרי). סגור אותו קודם. יוצא."); process.exit(1); }
  console.log("agent polling:", cfg.agentUrl);

  loadCreds();
  if (CREDS && CREDS.userId && CREDS.passcode) console.log("[reauth] פרטי התחברות-אוטומטית נטענו - הסוכן יתחבר מחדש לבד במקרה של ניתוק");
  else console.log("[reauth] אין פרטי התחברות-אוטומטית מלאים (agent-credentials.json) - ניתוק ידרוש login.js ידני");

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
