/**
 * בדיקת עשן חיה למעבדת טאביט, מול הייצור.
 *
 * עד 24.9 הסקריפט הזה רק הדפיס שאלה ותשובה, וההערכה הייתה על העין. עכשיו הוא
 * **מדרג**: לכל תרחיש יש כלים שחייבים לרוץ, ביטויים שחייבים להופיע וביטויים
 * שאסור שיופיעו. מה שנבדק כאן הוא הכשלים האמיתיים שהצוות ראה.
 *
 * קריאה בלבד מול טאביט. כן נוצרות שיחות מעבדה אמיתיות בהיסטוריה (מסומנות).
 * הרצה: NODE_OPTIONS=--use-system-ca ADMIN_TOKEN=<טוקן> node scripts/tabit-lab-e2e.mjs
 *        ...node scripts/tabit-lab-e2e.mjs --only=פיקדון
 */
import { writeFileSync, mkdirSync } from "fs";
mkdirSync("scan-data", { recursive: true });

const BASE = process.env.SCAN_BASE || "https://cavalli-chatbot.vercel.app";
const TOKEN = process.env.ADMIN_TOKEN || process.argv.find((a) => !a.startsWith("--") && a.length > 10 && !a.includes("/"));
if (!TOKEN) { console.error("חסר ADMIN_TOKEN"); process.exit(1); }

const login = await fetch(`${BASE}/api/admin/login`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ master: TOKEN }),
});
if (!login.ok) { console.error("login נכשל:", login.status); process.exit(1); }
const cookie = (login.headers.getSetCookie?.() || [login.headers.get("set-cookie") || ""])
  .map((c) => c.split(";")[0]).find((c) => /cavalli_session=/.test(c));
const H = { cookie, "x-admin-token": TOKEN, "content-type": "application/json" };

const IL = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const TODAY = IL(new Date());
const TOMORROW = IL(new Date(Date.now() + 86400000));
const YESTERDAY = IL(new Date(Date.now() - 86400000));
const OLD = IL(new Date(Date.now() - 12 * 86400000));
const short = (iso) => { const [, m, d] = iso.split("-").map(Number); return `${d}.${m}`; };

// cont = ממשיך את השיחה הקודמת (בדיקת המשכיות)
const SCENARIOS = [
  {
    name: "רשימת יום מהתצלום (אמור להיות מהיר)",
    q: `מה ההזמנות של ${short(TOMORROW)}?`,
    tools: ["tabit_read_day"], maxSecs: 25,
  },
  {
    name: "פיקדונות חסרים",
    q: `מי לא שילם פיקדון ב-${short(TOMORROW)}?`,
    tools: ["tabit_deposit_summary"],
  },
  {
    // ⭐ התקלה שהתחילה את הכל: צבירה שהוצגה כמספר של יום.
    name: "אי-הגעות וביטולים ליום מסוים",
    q: `כמה אי הגעות וביטולים היו ב-${short(YESTERDAY)}?`,
    tools: ["tabit_day_outcome"], notTools: ["tabit_no_show_summary"],
    mustNot: [/לא יכול לבדוק/, /לפני למעלה מחודש/],
  },
  {
    name: "מי בדיוק לא הגיע",
    q: `מי לא הגיע ב-${short(YESTERDAY)}?`,
    tools: ["tabit_day_outcome"],
  },
  {
    name: "הכנסות של יום",
    q: `כמה עשינו ב-${short(YESTERDAY)}?`,
    tools: ["tabit_revenue"],
  },
  {
    name: "מקורות הזמנה ליום",
    q: `מאיפה הגיעו ההזמנות של ${short(YESTERDAY)}?`,
    tools: ["tabit_booking_sources"],
  },
  {
    // ⭐ המגבלה האמיתית של טאביט: 24 שעות ארכיון. אין מספר, ולכן אסור מספר.
    name: "תקופה ארוכה: אומרים שלא זמין",
    q: "כמה אי-הגעות היו בחודש האחרון?",
    must: [/לא זמין|לא ניתן|אי אפשר|24 השעות|מוגבל|רק להיום|רק את היום/],
  },
  {
    name: "יום ישן: לא ממציאים ולא מדווחים אפס",
    q: `כמה אי-הגעות היו ב-${short(OLD)}?`,
    mustNot: [/^אפס/, /\b0 אי-הגעות/],
  },
  {
    name: "חיפוש הזמנה בלי לשאול יום קודם",
    q: "תמצא לי את ההזמנה של שני",
    tools: ["tabit_find_reservation"],
  },
  { name: "המשכיות: הטלפון שלה", q: "ומה הטלפון שלה?", cont: true },
  {
    name: "לוח שולחן בלי יום",
    q: "יש הזמנות על שולחן 70?",
    tools: ["tabit_table_schedule"],
  },
  {
    name: "מצב רצפה עכשיו",
    q: "מה מצב השולחנות עכשיו?",
    tools: ["tabit_tables_status"],
  },
  {
    name: "שבת סגורה: לא מדווחים זמינות",
    q: "יש מקום בשבת ב-13:00 לשישה?",
    must: [/סגור|לא מקבל|לא פתוח/],
  },
  {
    name: "סתירה בין יום לתאריך",
    q: `יש מקום ביום ראשון ${short(TOMORROW)} בערב לארבעה?`,
    must: [/שים לב|לא מסתדר|סתירה|בעצם|למה התכוונת|הוא יום/],
  },
  {
    name: "כתיבה מושבתת",
    q: "תבטל את ההזמנה של שני",
    notTools: ["tabit_cancel_reservation"],
    must: [/זמינ|מושבת|לא ניתן|לא אפשרי/],
  },
];

const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const list = only ? SCENARIOS.filter((s) => s.name.includes(only)) : SCENARIOS;

const out = [];
let sessionId = null;
let ok = 0;
const bad = [];

for (const s of list) {
  if (!s.cont) sessionId = null;
  console.log(`\n${"─".repeat(70)}\n🧪 ${s.name}\n   ❓ ${s.q}`);
  const started = Date.now();
  try {
    const r = await fetch(`${BASE}/api/admin/tabit/testchat`, {
      method: "POST", headers: H,
      body: JSON.stringify({ sessionId, message: s.q }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || r.status);
    sessionId = d.sessionId || sessionId;
    const secs = (Date.now() - started) / 1000;
    const log = d.toolLog || [];
    const names = log.map((t) => t.tool);
    console.log(`   🔧 ${log.map((t) => `${t.tool}${t.ok ? "" : " ❌"} ${t.ms ?? "?"}ms`).join(", ") || "(בלי כלים)"}`);
    console.log(`   💬 ${(d.reply || "").replace(/\n/g, "\n      ")}`);
    console.log(`   ⏱  ${secs.toFixed(1)} שניות`);

    const problems = [];
    for (const w of s.tools ?? []) if (!names.includes(w)) problems.push(`לא נקרא ${w}`);
    for (const b of s.notTools ?? []) if (names.includes(b)) problems.push(`נקרא כלי אסור ${b}`);
    for (const m of s.must ?? []) if (!m.test(d.reply || "")) problems.push(`חסר: ${m}`);
    for (const m of s.mustNot ?? []) if (m.test(d.reply || "")) problems.push(`אסור והופיע: ${m}`);
    for (const t of log) if (!t.ok) problems.push(`כלי נכשל: ${t.tool} - ${t.error}`);
    if (s.maxSecs && secs > s.maxSecs) problems.push(`איטי: ${secs.toFixed(1)} שניות (תקרה ${s.maxSecs})`);

    if (problems.length) { bad.push(`${s.name}: ${problems.join(" | ")}`); console.log(`   ⚠ ${problems.join(" | ")}`); }
    else ok++;
    out.push({ name: s.name, q: s.q, tools: names.join(", "), reply: d.reply, secs, problems });
  } catch (e) {
    bad.push(`${s.name}: 💥 ${e.message}`);
    console.log(`   💥 ${e.message}`);
    out.push({ name: s.name, q: s.q, error: e.message });
  }
}

const md = out.map((o) =>
  `## ${o.name}\n\n**שאלה:** ${o.q}\n\n**כלים:** ${o.tools || "-"}\n\n**זמן:** ${o.secs?.toFixed(1) ?? "-"} שניות\n\n` +
  (o.problems?.length ? `**בעיות:** ${o.problems.join(" | ")}\n\n` : "") +
  `**תשובה:**\n\n${o.reply || o.error || ""}\n`
).join("\n---\n\n");
writeFileSync("scan-data/lab-e2e.md", `# בדיקת עשן חיה - מעבדת טאביט\n\n${ok}/${list.length} עברו\n\n${md}`, "utf8");

console.log(`\n${"═".repeat(70)}\n${ok}/${list.length} תרחישים עברו · הפירוט ב-scan-data/lab-e2e.md`);
if (bad.length) { console.log("\nבעיות:"); for (const b of bad) console.log(`  ❌ ${b}`); }
process.exit(bad.length ? 1 : 0);
