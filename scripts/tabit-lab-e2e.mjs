// סוללת בדיקות קצה-לקצה למעבדת טאביט מול פרודקשן - מריצה את תרחישי הכשל
// שדווחו 15.9 + מקרי קצה, ומדפיסה שאלה/תשובה/כלים לכל תרחיש.
// הרצה: NODE_OPTIONS=--use-system-ca ADMIN_TOKEN=<טוקן> node scripts/tabit-lab-e2e.mjs
// קריאה בלבד מול טאביט; יוצר שיחות מעבדה אמיתיות (מסומנות [בדיקה אוטומטית]).
import { writeFileSync, mkdirSync } from "fs";
mkdirSync("scan-data", { recursive: true });

const BASE = process.env.SCAN_BASE || "https://cavalli-chatbot.vercel.app";
const TOKEN = process.env.ADMIN_TOKEN || process.argv[2];
if (!TOKEN) { console.error("חסר ADMIN_TOKEN"); process.exit(1); }

const login = await fetch(`${BASE}/api/admin/login`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ master: TOKEN }),
});
if (!login.ok) { console.error("login נכשל:", login.status); process.exit(1); }
const cookie = (login.headers.getSetCookie?.() || [login.headers.get("set-cookie") || ""])
  .map((c) => c.split(";")[0]).find((c) => /cavalli_session=/.test(c));
const H = { cookie, "x-admin-token": TOKEN, "content-type": "application/json" };

// [המשך] = ממשיך את השיחה הקודמת (בדיקת המשכיות)
const SCENARIOS = [
  { q: "יש מקום ליום ראשון 21.9 בשעה 18:30 לארבעה?", expect: "לזהות ש-21.9 הוא יום שני ולהצביע על הסתירה" },
  { q: "יש מקום ביום ראשון הקרוב בשעה 18:30 לזוג?", expect: "ראשון סגור ב-18:30 (שעות 08:00-18:00) - להגיד סגור ולהציע שעה חוקית" },
  { q: "יש מקום בשבת ב-13:00 לשישה?", expect: "שבת סגור - לא לדווח זמינות" },
  { q: "יש הזמנות על שולחנות 69 או 70?", expect: "tabit_table_schedule עם רשימה אמיתית (לא 'אין' בלי בדיקה)" },
  { q: "מה יש על שולחן 40 היום?", expect: "לוח שולחן 40 להיום + מי יושב עכשיו אם יש" },
  { q: "תמצא לי את ההזמנה של שני", expect: "tabit_find_reservation - למצוא את שני (גם בלי יום)" },
  { q: "ומה הטלפון שלה?", cont: true, expect: "המשכיות - טלפון מהתשובה הקודמת" },
  { q: "יש הזמנה על שם שני ביום רביעי?", expect: "אם לא ברביעי - להגיד באיזה יום כן (found_on_other_days)" },
  { q: "כמה מוזמנים מחר בערב?", expect: "covers_summary עם היום הנכון בשבוע" },
  { q: "יש מקום מחר ב-20:00 לשישה בחוץ?", expect: "מחר פתוח - זמינות אמיתית עם free_tables" },
  { q: "מי לא שילם פיקדון להיום?", expect: "deposit_summary של היום" },
  { q: "תמצא הזמנה של 0509800096", expect: "חיפוש לפי טלפון" },
];

const out = [];
let sessionId = null;
for (const s of SCENARIOS) {
  if (!s.cont) sessionId = null; // שיחה חדשה אלא אם זה תרחיש המשך
  process.stdout.write(`\n🧪 ${s.q}\n`);
  try {
    const r = await fetch(`${BASE}/api/admin/tabit/testchat`, {
      method: "POST", headers: H,
      body: JSON.stringify({ sessionId, message: s.q }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || r.status);
    sessionId = d.sessionId || sessionId;
    const tools = (d.toolLog || []).map((t) => `${t.tool}${t.ok ? "" : " ❌"}(${JSON.stringify(t.params)})`).join(", ") || "(בלי כלים)";
    console.log(`   כלים: ${tools}`);
    console.log(`   תשובה: ${(d.reply || "").slice(0, 500)}`);
    out.push({ q: s.q, expect: s.expect, tools, reply: d.reply });
  } catch (e) {
    console.log(`   ⚠ שגיאה: ${e.message}`);
    out.push({ q: s.q, expect: s.expect, error: e.message });
  }
}

const md = out.map((o) =>
  `## ${o.q}\n**מצופה:** ${o.expect}\n**כלים:** ${o.tools || "-"}\n**תשובה:**\n${o.reply || "⚠ " + o.error}\n`
).join("\n---\n");
writeFileSync("scan-data/lab-e2e-results.md", md);
console.log(`\n📄 סיכום מלא: scan-data/lab-e2e-results.md (${out.length} תרחישים)`);
