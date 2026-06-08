// בדיקת קצה-לקצה של הבוט עם UTF-8 תקין (curl ב-Windows משבש עברית).
// הרצה: node scripts/test-bot.mjs

const URL = "http://localhost:3000/api/chat";

const cases = [
  { label: "איזה יום היום", text: "איזה יום היום ומה השעה?" },
  { label: "פתוחים עכשיו?", text: "אתם פתוחים עכשיו?" },
  { label: "בדיקת איכות Haiku - מנה", text: "מה יש בסלט קוואלי וכמה הוא עולה?" },
  { label: "בדיקת איכות Haiku - יין בכוס", text: "אילו יינות יש בכוס?" },
  { label: "שנינות עדיין עובדת", text: "מה בירת אוסטרליה?" },
  { label: "רגיש נשאר רציני", text: "קיבלתי חדשות רעות היום ואני עצוב" },
];

for (const c of cases) {
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: c.text }] }),
  });
  const data = await res.json();
  console.log(`\n=== ${c.label} ===`);
  console.log(`👤 ${c.text}`);
  console.log(`🤖 ${data.reply ?? JSON.stringify(data)}`);
}
