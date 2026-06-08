const B = "http://localhost:3000";
let n = 0;
async function fresh(messages) {
  const clientId = "imp-" + Date.now() + "-" + n++;
  let conversationId;
  const out = [];
  for (const m of messages) {
    const r = await (
      await fetch(B + "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: m, conversationId, clientId }),
      })
    ).json();
    conversationId = r.conversationId;
    out.push({ user: m, reply: r.reply, status: r.status });
  }
  return out;
}

console.log("===== 1) פתיחה: רק 'היי' (בלי ברכה כפולה) =====");
for (const t of await fresh(["היי"])) console.log("🤖 " + t.reply);

console.log("\n===== 2) פתיחה עם שאלה אמיתית =====");
for (const t of await fresh(["כמה עולה קפוצ'ינו?"])) console.log("🤖 " + t.reply);

console.log("\n===== 3) שגיאת כתיב: 'קורסון' =====");
for (const t of await fresh(["כמה עולה קורסון?"])) console.log("🤖 " + t.reply);

console.log("\n===== 4) הסלמה חכמה: בקשת נציג ואז התעקשות =====");
for (const t of await fresh([
  "אני רוצה לדבר עם נציג אנושי",
  "לא, אני מתעקש, פשוט תעביר אותי לנציג",
])) {
  console.log(`👤 ${t.user}\n🤖 [${t.status}] ${t.reply}\n`);
}

console.log("===== 5) תלונה =====");
for (const t of await fresh(["השירות אצלכם היה גרוע, אני רוצה להתלונן"])) {
  console.log(`🤖 [${t.status}] ${t.reply}`);
}
