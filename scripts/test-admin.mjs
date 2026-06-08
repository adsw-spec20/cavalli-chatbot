// בדיקת ה-API של פאנל הניהול. הרצה: node scripts/test-admin.mjs
const B = "http://localhost:3000";

const stats = await (await fetch(B + "/api/admin/stats")).json();
console.log("=== STATS ===");
console.log(
  `שיחות: ${stats.totalConversations} | % הכלה: ${stats.deflectionRate}% | ממתינות לנציג: ${stats.needsAttention} | הסלמות: ${stats.escalated}`
);
console.log(
  "מילים נפוצות: " +
    stats.topWords.slice(0, 6).map((w) => `${w.word}(${w.count})`).join(", ")
);

const convs = await (await fetch(B + "/api/admin/conversations")).json();
console.log(`\n=== INBOX (${convs.length} שיחות) ===`);
for (const c of convs.slice(0, 5)) {
  console.log(
    `${c.status} ${c.escalated ? "[הסלמה]" : ""} - ${(c.lastMessage || "").slice(0, 45)}`
  );
}

const esc = convs.find((c) => c.status === "human");
if (esc) {
  console.log("\n=== נציג עונה בשיחה מוסלמת ===");
  await fetch(`${B}/api/admin/conversations/${esc.id}/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "reply",
      text: "היי, מדבר דני מהצוות, איך אפשר לעזור?",
    }),
  });
  const d = await (await fetch(`${B}/api/admin/conversations/${esc.id}`)).json();
  const last = d.messages[d.messages.length - 1];
  console.log(`הודעה אחרונה: role=${last.role} | ${last.content}`);

  // שחרור חזרה לבוט
  await fetch(`${B}/api/admin/conversations/${esc.id}/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "release" }),
  });
  const d2 = await (await fetch(`${B}/api/admin/conversations/${esc.id}`)).json();
  console.log(`אחרי שחרור: status=${d2.conversation.status}`);
}
