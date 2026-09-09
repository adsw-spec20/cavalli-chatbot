// משיכת שיחה אחת מהפרודקשן לצורך בדיקה. קריאה בלבד - שום דבר לא נשלח ולא משתנה.
//
// הרצה:
//   ADMIN_TOKEN=$(cat /path/to/token.txt) node scripts/pull-one-conversation.mjs "<חיפוש>"
//
// <חיפוש> = שם, חלק משם, או מספר טלפון. מדפיס את השיחה המלאה למסך.
// הטוקן נקרא ממשתנה הסביבה בלבד ולעולם לא מודפס.

const BASE = process.env.SCAN_BASE || "https://cavalli-chatbot.vercel.app";
const TOKEN = process.env.ADMIN_TOKEN;
const NEEDLE = process.argv[2];

if (!TOKEN) { console.error("חסר ADMIN_TOKEN"); process.exit(1); }
if (!NEEDLE) { console.error('חסר ביטוי חיפוש, למשל: node scripts/pull-one-conversation.mjs "Houda"'); process.exit(1); }

const login = await fetch(`${BASE}/api/admin/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ master: TOKEN }),
});
if (!login.ok) { console.error("login נכשל:", login.status); process.exit(1); }
const cookie = (login.headers.getSetCookie?.() || [login.headers.get("set-cookie") || ""])
  .map((c) => c.split(";")[0]).find((c) => /cavalli_session=/.test(c));
if (!cookie) { console.error("לא התקבל session cookie"); process.exit(1); }
const H = { cookie, "x-admin-token": TOKEN };

// רק ספרות, להשוואת טלפונים בפורמטים שונים (0525062212 / 972525062212 / עם מקפים)
const digits = (s) => (s || "").replace(/\D/g, "");
const needleDigits = digits(NEEDLE);
const tail = needleDigits.length >= 9 ? needleDigits.slice(-9) : null;

// החיפוש בשרת סורק את כל השיחות (לא רק 300 האחרונות)
const searched = await (await fetch(`${BASE}/api/admin/conversations?q=${encodeURIComponent(NEEDLE)}`, { headers: H })).json();
let list = Array.isArray(searched) ? searched : [];
if (!list.length) {
  const all = await (await fetch(`${BASE}/api/admin/conversations`, { headers: H })).json();
  list = Array.isArray(all) ? all : [];
}

const rx = new RegExp(NEEDLE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
const matches = list.filter(
  (c) => rx.test(c.customerName || "") || (tail && digits(c.customerId).endsWith(tail))
);

if (!matches.length) {
  console.error(`לא נמצאה שיחה עבור "${NEEDLE}". נסרקו ${list.length} שיחות.`);
  process.exit(2);
}

matches.sort((a, b) => b.updatedAt - a.updatedAt);
console.log(`נמצאו ${matches.length} שיחות. מציג את העדכנית ביותר.\n`);

const target = matches[0];
const d = await (await fetch(`${BASE}/api/admin/conversations/${target.id}?all=1`, { headers: H })).json();

const t = (ts) => new Date(ts).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" });
console.log("=".repeat(70));
console.log(`שיחה: ${target.id}`);
console.log(`לקוח: ${d.customer?.name || target.customerName || "-"} | ${d.customer?.channelUserId || target.customerId}`);
console.log(`ערוץ: ${target.channel} | סטטוס: ${target.status} | הוסלמה: ${target.escalated ? "כן" : "לא"}${target.escalationReason ? ` (${target.escalationReason})` : ""}`);
console.log(`בוט מושהה: ${target.botPaused ? "כן" : "לא"} | עודכן: ${t(target.updatedAt)}`);
console.log(`הודעות: ${(d.messages || []).length}`);
console.log("=".repeat(70));

for (const m of d.messages || []) {
  const who = m.role === "user" ? "לקוח" : m.role === "assistant" ? "בוט" : m.role === "agent" ? "נציג" : "מערכת";
  console.log(`\n[${t(m.ts)}] ${who}:`);
  console.log(m.content);
}
console.log("\n" + "=".repeat(70));
