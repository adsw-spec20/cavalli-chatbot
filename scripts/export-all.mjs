/**
 * שאיבת כל היסטוריית השיחות לניתוח (קריאה בלבד).
 *   NODE_OPTIONS=--use-system-ca ADMIN_TOKEN=<token> node scripts/export-all.mjs [base] [outfile]
 * דורש את נתיב /api/admin/export (מנהל ראשי בלבד) שנוסף 15.9.
 */
import { writeFileSync } from "node:fs";
const BASE = process.argv[2] || "https://cavalli-chatbot.vercel.app";
const OUT = process.argv[3] || "all-conversations.json";
const TOKEN = process.env.ADMIN_TOKEN;
if (!TOKEN) { console.error("חסר ADMIN_TOKEN"); process.exit(1); }

const login = await fetch(`${BASE}/api/admin/login`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ master: TOKEN }),
});
if (!login.ok) { console.error("login נכשל:", login.status); process.exit(1); }
const cookie = (login.headers.getSetCookie?.() || [login.headers.get("set-cookie") || ""])
  .map((c) => c.split(";")[0]).find((c) => /cavalli_session=/.test(c));
const H = { cookie, "x-admin-token": TOKEN };

const all = [];
let offset = 0, total = null;
const LIMIT = 150;
while (total === null || offset < total) {
  const r = await fetch(`${BASE}/api/admin/export?offset=${offset}&limit=${LIMIT}`, { headers: H });
  if (!r.ok) { console.error(`שגיאה ב-offset ${offset}:`, r.status); break; }
  const j = await r.json();
  total = j.total;
  all.push(...j.conversations);
  offset += j.returned || LIMIT;
  process.stdout.write(`\r  ${all.length}/${total}`);
  if (!j.returned) break;
}
console.log("");
writeFileSync(OUT, JSON.stringify(all));
const msgs = all.reduce((s, c) => s + c.messages.length, 0);
console.log(`נשמרו ${all.length} שיחות (${msgs.toLocaleString()} הודעות) -> ${OUT}`);
