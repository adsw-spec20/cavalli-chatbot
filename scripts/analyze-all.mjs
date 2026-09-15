/**
 * ניתוח כל היסטוריית השיחות. עלות אפס - לא נשלח דבר למודל.
 *   node scripts/analyze-all.mjs all-conversations.json [out.md]
 *
 * עונה על השאלות שאי אפשר היה לענות עליהן עד היום, כי הסריקות כיסו 300 שיחות
 * מתוך 5,168: מה באמת שואלים, כמה מזה נענה בחינם, איפה שיחות נתקעות, ומה
 * הדפוסים שחוזרים מספיק כדי להצדיק תבנית או כלל.
 */
import { readFileSync, writeFileSync } from "node:fs";

const IN = process.argv[2] || "all-conversations.json";
const OUT = process.argv[3] || "";
const convs = JSON.parse(readFileSync(IN, "utf8"));

const out = [];
const say = (s = "") => { out.push(s); console.log(s); };

// ----- מיזוג תורים: הודעות לקוח רצופות = תור אחד, כמו שהשרת עושה -----
const turnsOf = (msgs) => {
  const t = [];
  let buf = [];
  for (const m of msgs) {
    if (m.role === "user") { buf.push(m); continue; }
    if (m.role === "assistant" && buf.length) {
      const meta = m.meta ?? {};
      t.push({
        text: buf.map((x) => x.content).join("\n"),
        first: buf[0],
        reply: m,
        free: !!(meta.canned || meta.gateReply),
        cannedKey: meta.canned ?? (meta.gateReply ? "gate" : null),
        escalated: !!meta.escalation,
        waitMs: m.ts && buf[0].ts ? m.ts - buf[0].ts : null,
      });
      buf = [];
    } else if (m.role === "assistant") buf = [];
  }
  return { turns: t, unanswered: buf.length };
};

const norm = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();

let totalTurns = 0, freeTurns = 0, paidTurns = 0, unansweredTurns = 0;
const paidCount = new Map();
const freeCount = new Map();
const cannedKeys = new Map();
const byChannel = new Map();
const byHour = new Array(24).fill(0);
const escalationFirstMsg = [];
const waitSamples = [];
let convWithAnyUser = 0;
let oneAndDone = 0;
const longConvs = [];

for (const c of convs) {
  const { turns, unanswered } = turnsOf(c.messages);
  unansweredTurns += unanswered;
  const userMsgs = c.messages.filter((m) => m.role === "user");
  if (userMsgs.length) convWithAnyUser++;
  if (userMsgs.length === 1) oneAndDone++;
  if (turns.length >= 6) longConvs.push({ id: c.id, turns: turns.length, channel: c.channel });

  byChannel.set(c.channel, (byChannel.get(c.channel) ?? 0) + 1);
  for (const m of userMsgs) {
    if (!m.ts) continue;
    const h = new Date(m.ts + 3 * 3600_000).getUTCHours();
    byHour[h]++;
  }
  if (c.escalated && userMsgs[0]) escalationFirstMsg.push(userMsgs[0].content.slice(0, 90));

  for (const t of turns) {
    totalTurns++;
    if (t.waitMs != null && t.waitMs > 0 && t.waitMs < 120000) waitSamples.push(t.waitMs);
    const key = norm(t.text).slice(0, 70);
    if (t.free) {
      freeTurns++;
      freeCount.set(key, (freeCount.get(key) ?? 0) + 1);
      if (t.cannedKey) cannedKeys.set(t.cannedKey, (cannedKeys.get(t.cannedKey) ?? 0) + 1);
    } else {
      paidTurns++;
      paidCount.set(key, (paidCount.get(key) ?? 0) + 1);
    }
  }
}

const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) : "0");
const top = (map, n = 25) => [...map].sort((a, b) => b[1] - a[1]).slice(0, n);

say(`# ניתוח מלא של היסטוריית השיחות`);
say(`נוצר: ${new Date().toLocaleString("he-IL")}`);
say();
say(`## תמונת מצב`);
say(`- שיחות: **${convs.length.toLocaleString()}** (עם הודעת לקוח: ${convWithAnyUser.toLocaleString()})`);
say(`- תורים (לקוח -> בוט): **${totalTurns.toLocaleString()}**`);
say(`- נענו בחינם: **${freeTurns.toLocaleString()} (${pct(freeTurns, totalTurns)}%)**`);
say(`- עלו כסף: **${paidTurns.toLocaleString()} (${pct(paidTurns, totalTurns)}%)**`);
say(`- הודעות לקוח שלא נענו כלל: ${unansweredTurns.toLocaleString()}`);
say(`- שיחות של הודעה אחת בלבד: ${oneAndDone.toLocaleString()} (${pct(oneAndDone, convs.length)}%)`);
say();

say(`## ערוצים`);
for (const [ch, n] of top(byChannel, 10)) say(`- ${ch}: ${n.toLocaleString()} (${pct(n, convs.length)}%)`);
say();

say(`## אילו תבניות חינמיות עובדות בפועל`);
say(`(כמה פעמים כל תבנית חסכה קריאה למודל)`);
for (const [k, n] of top(cannedKeys, 20)) say(`- \`${k}\`: ${n.toLocaleString()}`);
say();

say(`## 25 השאלות הנפוצות ביותר שעולות כסף`);
say(`אלה המועמדות הטובות ביותר לתבנית חדשה או לכלל חד יותר.`);
say();
say(`| # | פעמים | השאלה |`);
say(`|---|---|---|`);
top(paidCount, 25).forEach(([q, n], i) => say(`| ${i + 1} | ${n} | ${q.replace(/\|/g, "/").slice(0, 90)} |`));
say();

say(`## שעות השיא (שעון ישראל)`);
const maxH = Math.max(...byHour);
byHour.forEach((n, h) => {
  if (n < maxH * 0.25) return;
  say(`- ${String(h).padStart(2, "0")}:00  ${"█".repeat(Math.round((n / maxH) * 30))} ${n.toLocaleString()}`);
});
say();

if (waitSamples.length) {
  waitSamples.sort((a, b) => a - b);
  const p = (q) => (waitSamples[Math.floor(waitSamples.length * q)] / 1000).toFixed(1);
  say(`## זמן תגובה`);
  say(`- חציון: ${p(0.5)} שניות`);
  say(`- אחוזון 90: ${p(0.9)} שניות`);
  say(`- אחוזון 99: ${p(0.99)} שניות`);
  say();
}

say(`## הסלמות לנציג אנושי`);
say(`סה"כ ${escalationFirstMsg.length.toLocaleString()} שיחות הוסלמו. ההודעה הפותחת בעשר האחרונות:`);
for (const m of escalationFirstMsg.slice(0, 10)) say(`- ${m.replace(/\n/g, " ")}`);
say();

say(`## שיחות ארוכות (6+ תורים)`);
say(`${longConvs.length.toLocaleString()} שיחות. אלה הכי יקרות, כי כל תור שולח מחדש את ההיסטוריה.`);
say();

if (OUT) { writeFileSync(OUT, out.join("\n")); console.log(`\nנשמר ל-${OUT}`); }
