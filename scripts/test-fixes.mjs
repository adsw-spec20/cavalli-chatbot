// בדיקה ידנית מהירה של התיקונים מהדיווח של המשתמש. הרצה: node scripts/test-fixes.mjs
const B = process.argv[2] || "http://localhost:3000";

async function send(text, conversationId, clientId) {
  const r = await fetch(B + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: text, conversationId, clientId }),
  });
  return r.json();
}

async function convo(name, turns) {
  console.log(`\n===== ${name} =====`);
  const clientId = "fix-" + Date.now() + "-" + Math.floor(Math.random() * 1e6);
  let cid;
  for (const t of turns) {
    const res = await send(t, cid, clientId);
    cid = res.conversationId;
    console.log(`👤 ${t}`);
    console.log(`🤖 ${res.reply}`);
    if (res.media?.length) console.log(`   📎 מדיה: ${res.media.length}`);
  }
}

await convo("מוצ\"ש (טבעיות)", ["אתם פתוחים בשבת בבוקר?", "ובמוצש?"]);
await convo("פרידה - לילה טוב", ["תודה על העזרה", "לילה טוב"]);
await convo("שאלת המשך עמומה - בתשלום", ["יש חניה?", "בתשלום?"]);
await convo("הזמנת מקום (בלי markdown)", ["אפשר להזמין מקום?"]);
await convo("פתוח עכשיו (בלי חישוב זמן)", ["אתם פתוחים עכשיו? עד מתי?"]);
await convo("שתי שאלות + חניה", ["כמה עולה קפוצ'ינו ויש חניה?"]);
