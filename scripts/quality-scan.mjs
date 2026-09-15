/**
 * סריקת איכות על כל היסטוריית השיחות: אילו פגמים באמת הגיעו ללקוחות.
 * עלות אפס. node scripts/quality-scan.mjs all-conversations.json
 *
 * הכללים כאן הם אותם כללים שסוויטת הבדיקות אוכפת, אבל כאן הם רצים על
 * המציאות במקום על מקרי בדיקה - כדי לדעת אם הכלל באמת מחזיק בשטח.
 */
import { readFileSync } from "node:fs";

const convs = JSON.parse(readFileSync(process.argv[2] || "all-conversations.json", "utf8"));

const CHECKS = [
  { name: "לוכסן אחורי לפני כוכבית/מקף", rx: /\\[*\-]/, note: "מוצג ללקוח כתו גולמי" },
  { name: "הדגשה בכוכבית כפולה", rx: /\*\*/, note: "מוצג כתווים גולמיים בוואטסאפ" },
  { name: "קו מפריד גולמי", rx: /(^|\n)\s*---+\s*(\n|$)/, note: "לא נתמך בצ'אטים" },
  { name: "חצים", rx: /[←→⬅➡⇐⇒]/, note: "מתהפכים ב-RTL" },
  { name: "לשון נקבה (הבוט זכר)", rx: /אני מבינה|מבינה אותך|אני ממליצה|אשמח לעזור לך, מבינה/, note: "" },
  { name: "עברית שבורה ידועה", rx: /משהו אפשר לעזור|בא לנכון|אגיד לי|לחייגו|כמה יפה/, note: "" },
  { name: "טענת קיזוז פיקדון שגויה", rx: /(?<!לא )(?<!אינו )(מתקזז|מנוכה)[^.\n]{0,40}(מהחשבון|החשבון הסופי)/, note: "מידע שגוי ללקוח" },
  { name: "מדיניות פיקדון חלקית", rx: /מחויב רק ב(מקרה של )?אי[- ]הגעה/, note: "משמיט ביטול מתחת ל-24 שעות" },
  { name: "הבטחת הזמנה סופית", rx: /שריינתי לכם|ההזמנה נקלטה|המקום שמור לכם/, note: "רק הצוות מאשר" },
  { name: "דליפת קריאת כלי", rx: /<tool_call|"tool"\s*:/, note: "" },
  { name: "אומדן זמן שנותר", rx: /(יש|נשאר|נשארו) עוד כ-?\s*(שעה|שעתיים|חצי שעה|\d+\s*(דקות|שעות))/, note: "הבוט טועה בחשבון" },
];

let totalBot = 0;
const hits = CHECKS.map(() => ({ n: 0, samples: [], bySource: new Map() }));

for (const c of convs) {
  for (const m of c.messages) {
    if (m.role !== "assistant") continue;
    totalBot++;
    const t = m.content || "";
    const meta = m.meta ?? {};
    const src = meta.canned ? `תבנית:${meta.canned}` : meta.gateReply ? "שער" : "מודל";
    CHECKS.forEach((chk, i) => {
      if (!chk.rx.test(t)) return;
      const h = hits[i];
      h.n++;
      h.bySource.set(src, (h.bySource.get(src) ?? 0) + 1);
      if (h.samples.length < 2) {
        const at = t.search(chk.rx);
        h.samples.push(t.slice(Math.max(0, at - 60), at + 90).replace(/\n/g, " "));
      }
    });
  }
}

console.log(`# סריקת איכות על ${convs.length.toLocaleString()} שיחות (${totalBot.toLocaleString()} הודעות בוט)\n`);
let clean = 0;
for (let i = 0; i < CHECKS.length; i++) {
  const h = hits[i];
  const c = CHECKS[i];
  if (h.n === 0) { clean++; continue; }
  const pct = ((h.n / totalBot) * 100).toFixed(2);
  console.log(`## ${c.name} — ${h.n.toLocaleString()} הודעות (${pct}%)${c.note ? `  · ${c.note}` : ""}`);
  console.log(`   מקורות: ${[...h.bySource].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  for (const s of h.samples) console.log(`   דוגמה: ...${s}...`);
  console.log();
}
console.log(`${clean} מתוך ${CHECKS.length} הבדיקות נקיות לחלוטין בכל ההיסטוריה.`);
