// מצליב את הגדרות "לקוח ביטל" ו"לקוח לא הגיע" מול מה שהממשק של טאביט מראה.
//
// הרקע: הממשק מראה ל-23/9 ארבעה ביטולים וחמש-עשרה אי-הגעות. הספירה שלנו נתנה
// מספרים אחרים, והמטרה כאן היא למצוא איזה שדה בדיוק מפריד בין מה שנספר לבין
// מה שלא. בלי זה הבוט ייתן מספר שסותר את המסך שהמנהל פתוח מולו.
//
// ⚠️ דורש שהסוכן יהיה עצור.
// הרצה: node probe-day-window.js 2026-09-23

const { chromium } = require("playwright");
const path = require("path");

const PROFILE_DIR = path.join(__dirname, "tabit-profile");
const APP_URL = "https://tgm-app.tabit.cloud/";
const API = "https://tgm-api.tabit.cloud";
const HEADERS = {
  "x-org-id": "68f0eebde7aadd617c316921",
  "x-org-name": "%D7%A7%D7%A4%D7%94%20%D7%A7%D7%95%D7%95%D7%90%D7%9C%D7%99%20%D7%95%D7%9E%D7%A1%D7%A2%D7%93%D7%94",
  "x-tg-device-name": "17525a1739a1a6462597151414a19a49_1788253833494",
  "x-app-version": "12.1.0",
  "content-type": "application/json",
  accept: "application/json, text/plain, */*",
};
const TZ = "Asia/Jerusalem";
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("he-IL", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });

const DAY = process.argv[2] || "2026-09-23";
const addDays = (iso, n) => {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
};

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1280, height: 800 } });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(6000);

  const fetchWindow = (fromISO, untilISO) =>
    page.evaluate(
      async ({ API, HEADERS, fromISO, untilISO }) => {
        const qs = `from=${encodeURIComponent(fromISO)}&until=${encodeURIComponent(untilISO)}&tgmv=${Date.now()}`;
        const res = await fetch(`${API}/reservations-archived?${qs}`, { headers: HEADERS, credentials: "include" });
        let body = null;
        try { body = await res.json(); } catch (_) {}
        return { status: res.status, items: Array.isArray(body) ? body : [], err: Array.isArray(body) ? null : JSON.stringify(body).slice(0, 200) };
      },
      { API, HEADERS, fromISO, untilISO }
    );

  const windows = [
    ["יממה קלנדרית 00:00-23:59", `${DAY}T00:00:00+03:00`, `${DAY}T23:59:00+03:00`],
    ["יום עסקי 08:00 עד 02:00 למחרת", `${DAY}T08:00:00+03:00`, `${addDays(DAY, 1)}T02:00:00+03:00`],
    ["בדיוק כמו האפליקציה (05:00Z עד 21:14Z)", `${DAY}T05:00:00.000Z`, `${DAY}T21:14:00.000Z`],
  ];

  for (const [label, fromISO, untilISO] of windows) {
    const r = await fetchWindow(fromISO, untilISO);
    if (r.status !== 200) { console.log(`\n✗ ${label}: status=${r.status} ${r.err}`); continue; }
    console.log(`\n===== ${label} =====`);
    console.log(`  ${r.items.length} רשומות בחלון`);

    const onDay = r.items.filter((x) => {
      const d = x.reservation_details || {};
      return d.reserved_from && dayFmt.format(new Date(d.reserved_from)) === DAY;
    });
    console.log(`  ${onDay.length} מתוכן עם תאריך הזמנה ${DAY}`);

    const hist = {};
    for (const x of onDay) {
      const named = !!((x.reservation_details || {}).customer || {}).name;
      const key = `${x.archived_reason || "(ריק)"} | ${x.type === "walked_in" ? "מזדמן" : "הזמנה"} | ${named ? "עם שם" : "בלי שם"}`;
      hist[key] = (hist[key] || 0) + 1;
    }
    for (const [k, v] of Object.entries(hist).sort((a, b) => b[1] - a[1])) console.log(`    ${String(v).padStart(4)}  ${k}`);

    // המועמדים למספרים שהממשק מראה
    const noShowAll = onDay.filter((x) => x.archived_reason === "no_show");
    const cancelAll = onDay.filter((x) => ["customer_cancelled", "cancelled", "אחר"].includes(x.archived_reason || ""));
    const named = (a) => a.filter((x) => !!((x.reservation_details || {}).customer || {}).name);
    const booked = (a) => a.filter((x) => x.type !== "walked_in");
    console.log(`  --- מועמדים ל"לקוח לא הגיע" ---`);
    console.log(`    כל no_show: ${noShowAll.length} | רק הזמנות: ${booked(noShowAll).length} | רק עם שם: ${named(noShowAll).length}`);
    console.log(`  --- מועמדים ל"לקוח ביטל" ---`);
    console.log(`    כל הביטולים: ${cancelAll.length} | רק customer_cancelled: ${onDay.filter((x) => x.archived_reason === "customer_cancelled").length}`);
    console.log(`    רק הזמנות: ${booked(cancelAll).length} | רק עם שם: ${named(cancelAll).length} | הזמנות עם שם: ${named(booked(cancelAll)).length}`);

    if (label.startsWith("יממה")) {
      console.log(`  --- פירוט הביטולים ---`);
      for (const x of cancelAll) {
        const d = x.reservation_details || {};
        const c = d.customer || {};
        console.log(`    ${timeFmt.format(new Date(d.reserved_from))}  reason=${x.archived_reason}  type=${x.type || "-"}  seats=${d.seats_count}  name="${c.name || ""}"  phone="${c.phone || ""}"  online=${!!x.online_booking}  state=${x.state || "-"}`);
      }
      console.log(`  --- פירוט אי-ההגעות ---`);
      for (const x of noShowAll) {
        const d = x.reservation_details || {};
        const c = d.customer || {};
        console.log(`    ${timeFmt.format(new Date(d.reserved_from))}  type=${x.type || "-"}  seats=${d.seats_count}  name="${c.name || ""}"  phone="${c.phone || ""}"  online=${!!x.online_booking}`);
      }
    }
  }

  await ctx.close().catch(() => {});
})();
