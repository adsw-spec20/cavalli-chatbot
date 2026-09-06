// שאיבת שיחות פרודקשן לסריקה התקופתית. קריאה בלבד - שום דבר לא נשלח/משתנה.
// הרצה (מתוך שורש הפרויקט):
//   NODE_OPTIONS=--use-system-ca ADMIN_TOKEN=<הטוקן-שלך> node scripts/scan-pull.mjs
// מתחבר לפאנל (login מנהל), שולף את כל השיחות מ-27.8.2026 עד היום (כל הערוצים)
// עם ההיסטוריה המלאה, ומחלק לאצוות JSON תחת ./scan-data/ (ב-gitignore, לא נדחף).
import { writeFileSync, mkdirSync } from "fs";

const BASE = process.env.SCAN_BASE || "https://cavalli-chatbot.vercel.app";
const TOKEN = process.env.ADMIN_TOKEN || process.argv[2];
if (!TOKEN) { console.error("חסר ADMIN_TOKEN (משתנה סביבה או ארגומנט ראשון)"); process.exit(1); }
const CUTOFF = new Date("2026-08-27T00:00:00+03:00").getTime();
const OUT = "scan-data";

const login = await fetch(`${BASE}/api/admin/login`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ master: TOKEN }),
});
if (!login.ok) { console.error("login נכשל:", login.status); process.exit(1); }
const cookie = (login.headers.getSetCookie?.() || [login.headers.get("set-cookie") || ""])
  .map((c) => c.split(";")[0]).find((c) => /cavalli_session=/.test(c));
if (!cookie) { console.error("לא התקבל session cookie"); process.exit(1); }
const H = { cookie };

const list = await (await fetch(`${BASE}/api/admin/conversations`, { headers: H })).json();
const inRange = list.filter((c) => c.updatedAt >= CUTOFF);
console.log(`סה"כ שיחות=${list.length}, מ-27.8=${inRange.length}. שואב היסטוריות...`);

const out = [];
let i = 0;
for (const c of inRange) {
  i++;
  try {
    const d = await (await fetch(`${BASE}/api/admin/conversations/${c.id}?all=1`, { headers: H })).json();
    const msgs = (d.messages || []).map((m) => ({ role: m.role, content: m.content, ts: m.ts }));
    if (!msgs.some((m) => m.role === "user") || !msgs.some((m) => m.role === "assistant")) continue;
    out.push({
      id: c.id, channel: c.channel, status: c.status,
      escalated: !!c.escalated, escalationReason: c.escalationReason || null,
      customerName: c.customerName || null, updatedAt: c.updatedAt, messages: msgs,
    });
  } catch (e) { console.error(`  שגיאה בשיחה ${c.id}:`, e.message); }
  if (i % 25 === 0) console.log(`  ...${i}/${inRange.length}`);
}

mkdirSync(OUT, { recursive: true });
const BATCH = 12;
let b = 0;
for (let j = 0; j < out.length; j += BATCH, b++)
  writeFileSync(`${OUT}/scan-batch-${String(b).padStart(2, "0")}.json`, JSON.stringify(out.slice(j, j + BATCH), null, 1));
const byChannel = {};
for (const c of out) byChannel[c.channel] = (byChannel[c.channel] || 0) + 1;
writeFileSync(`${OUT}/manifest.json`, JSON.stringify(
  { from: "2026-08-27", realConversations: out.length, batches: b, byChannel, totalMessages: out.reduce((s, c) => s + c.messages.length, 0) }, null, 2));
console.log(`סיום: ${out.length} שיחות -> ${b} אצוות ב-./${OUT}/`);
