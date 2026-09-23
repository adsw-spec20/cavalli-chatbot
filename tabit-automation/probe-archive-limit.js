// סבב חקירה שני: למה בקשת ארכיון ארוכה חוזרת 400, כשהאפליקציה של טאביט עצמה
// מבקשת מתחילת החודש ומקבלת תשובה. מדפיס גם את גוף השגיאה.
//
// ⚠️ דורש שהסוכן יהיה עצור.
// הרצה: node probe-archive2.js

const a = require("./agent.js");

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

(async () => {
  a.loadCreds();
  const b = await a.launchBrowser();
  const page = b.page;

  const call = (qs) =>
    page.evaluate(
      async ({ API, HEADERS, qs }) => {
        const res = await fetch(`${API}/reservations-archived?${qs}`, { headers: HEADERS, credentials: "include" });
        let body = null;
        try { body = await res.json(); } catch (_) {}
        if (Array.isArray(body)) {
          return { status: res.status, n: body.length, days: body.map((x) => (x.reservation_details || {}).reserved_from).filter(Boolean) };
        }
        return { status: res.status, n: null, err: JSON.stringify(body).slice(0, 300) };
      },
      { API, HEADERS, qs }
    );

  const tgmv = () => `tgmv=${Date.now()}`;
  const now = new Date();
  const monthStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01T02:00:00.000Z`;
  const back = (d) => new Date(Date.now() - d * 86400000).toISOString();
  const midnightIL = (d) => {
    const iso = dayFmt.format(new Date(Date.now() - d * 86400000));
    return new Date(`${iso}T00:00:00+03:00`).toISOString();
  };

  const tests = [
    ["בדיוק כמו האפליקציה (תחילת החודש)", `from=${encodeURIComponent(monthStart)}&${tgmv()}`],
    ["תחילת החודש, בלי tgmv", `from=${encodeURIComponent(monthStart)}`],
    ["חצות ישראל, יומיים אחורה", `from=${encodeURIComponent(midnightIL(2))}&${tgmv()}`],
    ["חצות ישראל, 3 ימים אחורה", `from=${encodeURIComponent(midnightIL(3))}&${tgmv()}`],
    ["חצות ישראל, 7 ימים אחורה", `from=${encodeURIComponent(midnightIL(7))}&${tgmv()}`],
    ["חצות ישראל, 14 ימים אחורה", `from=${encodeURIComponent(midnightIL(14))}&${tgmv()}`],
    ["חצות ישראל, 30 ימים אחורה", `from=${encodeURIComponent(midnightIL(30))}&${tgmv()}`],
    ["זמן שרירותי, יומיים אחורה", `from=${encodeURIComponent(back(2))}&${tgmv()}`],
    ["זמן שרירותי, 5 ימים אחורה", `from=${encodeURIComponent(back(5))}&${tgmv()}`],
  ];

  for (const [name, qs] of tests) {
    try {
      const r = await call(qs);
      if (r.n == null) { console.log(`  ✗ ${name}: status=${r.status} ${r.err || ""}`); continue; }
      const days = [...new Set(r.days.map((s) => dayFmt.format(new Date(s))))].sort();
      console.log(`  ✓ ${name}: ${r.n} פריטים | ימי הזמנה ${days[0]} עד ${days[days.length - 1]} (${days.length} ימים)`);
    } catch (e) {
      console.log(`  ✗ ${name}: ${e.message}`);
    }
  }

  await b.ctx.close().catch(() => {});
})();
