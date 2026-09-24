// לוכד איך אפליקציית טאביט עצמה שולפת יום שעבר.
//
// הרקע: בדיקה ישירה מול /reservations-archived?from=... הראתה שכל טווח ארוך
// מ-24 שעות חוזר 400 ("invalid requested time range"). אבל בממשק אפשר לנווט
// שבועות וחודשים אחורה ולראות ביטולים ואי-הגעות. כלומר הממשק שואל אחרת.
//
// הסקריפט טוען את האפליקציה, מוצא את חצי ניווט התאריך, לוחץ אחורה, ומדפיס כל
// בקשה ל-tgm-api **עם קוד התגובה**. קריאה בלבד.
//
// ⚠️ דורש שהסוכן יהיה עצור (הוא נועל את פרופיל הדפדפן).
// הרצה: node capture-archive.js [כמה ימים אחורה]

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const PROFILE_DIR = path.join(__dirname, "tabit-profile");
const APP_URL = "https://tgm-app.tabit.cloud/";
const OUT = path.join(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true });

const BACK = Number(process.argv[2] || 2);

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    viewport: { width: 1600, height: 950 },
  });
  const page = ctx.pages()[0] || (await ctx.newPage());

  let phase = "load";
  const calls = [];
  page.on("response", async (resp) => {
    const url = resp.url();
    if (!url.includes("tgm-api.tabit.cloud")) return;
    const u = new URL(url);
    let n = null;
    try {
      const ct = resp.headers()["content-type"] || "";
      if (ct.includes("json")) {
        const body = await resp.json().catch(() => null);
        n = Array.isArray(body) ? body.length : body && typeof body === "object" ? "obj" : null;
      }
    } catch (_) {}
    calls.push({ phase, status: resp.status(), pathname: u.pathname, query: decodeURIComponent(u.search), items: n });
  });

  await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(9000);

  // כפתורי החצים הם אייקוני Material: הטקסט שלהם הוא שם האייקון עצמו.
  const findNav = () =>
    page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll("button, [role=button]")) {
        const txt = (el.textContent || "").trim();
        if (!/^(arrow_back|arrow_forward|chevron_left|chevron_right|keyboard_arrow_left|keyboard_arrow_right)$/.test(txt)) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        out.push({ icon: txt, aria: el.getAttribute("aria-label") || "", x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
      }
      return out;
    });

  const dateText = () =>
    page.evaluate(() => {
      const el = document.querySelector(".tgm-date-picker-trigger");
      return el ? (el.textContent || "").trim() : null;
    });

  const nav = await findNav();
  console.log(`=== חצי ניווט (${nav.length}) ===`);
  for (const n of nav) console.log(`  ${n.icon} aria="${n.aria}" @${n.x},${n.y}`);
  console.log(`תאריך נוכחי: ${await dateText()}`);

  // לוחצים על כל חץ פעם אחת ורואים לאן התאריך זז. כך לא צריך לנחש כיוון ב-RTL.
  let backBtn = null;
  for (const n of nav.slice(0, 4)) {
    const before = await dateText();
    phase = `probe-${n.icon}@${n.x}`;
    await page.mouse.click(n.x, n.y);
    await page.waitForTimeout(3000);
    const after = await dateText();
    console.log(`  לחיצה על ${n.icon} @${n.x}: ${before} -> ${after}`);
    if (after && before && after !== before) {
      // מחזירים למצב ההתחלתי ומסמנים אם זה הכיוון אחורה
      const beforeNum = (before.match(/(\d{1,2})\/(\d{1,2})/) || []).slice(1).map(Number);
      const afterNum = (after.match(/(\d{1,2})\/(\d{1,2})/) || []).slice(1).map(Number);
      if (beforeNum.length && afterNum.length) {
        const wentBack = afterNum[1] < beforeNum[1] || (afterNum[1] === beforeNum[1] && afterNum[0] < beforeNum[0]);
        if (wentBack) { backBtn = n; break; }
      }
      // לא אחורה - חוזרים
      const other = nav.find((m) => m.x !== n.x && Math.abs(m.y - n.y) < 20);
      if (other) { await page.mouse.click(other.x, other.y); await page.waitForTimeout(2500); }
    }
  }

  if (backBtn) {
    phase = "back";
    for (let i = 1; i < BACK; i++) {
      await page.mouse.click(backBtn.x, backBtn.y);
      await page.waitForTimeout(3500);
    }
    console.log(`\nאחרי ${BACK} לחיצות אחורה, התאריך: ${await dateText()}`);
    await page.screenshot({ path: path.join(OUT, "archive-back.png") });
  } else {
    console.log("\n⚠ לא זוהה חץ שמזיז אחורה");
    await page.screenshot({ path: path.join(OUT, "archive-noback.png") });
  }

  console.log("\n=== בקשות, לפי שלב ===");
  for (const c of calls) {
    if (c.phase === "load" && !/reservations|archived/.test(c.pathname)) continue;
    console.log(`  [${c.phase}] ${c.status} ${c.pathname}${c.query}  items=${c.items}`);
  }
  fs.writeFileSync(path.join(OUT, "archive-calls.json"), JSON.stringify(calls, null, 2), "utf8");
  console.log("\nנשמר ב-out/archive-calls.json");

  await ctx.close().catch(() => {});
})();
