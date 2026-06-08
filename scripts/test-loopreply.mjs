const B = "http://localhost:3000";
async function chat(message, clientId) {
  const r = await (await fetch(B + "/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, clientId }),
  })).json();
  return r.reply;
}
// first-turn unknown specific detail
console.log("👤 (הודעה ראשונה) איזה מתקנים בדיוק יש בגינת הילדים?");
console.log("🤖 " + await chat("איזה מתקנים בדיוק יש בגינת הילדים?", "lr-" + Date.now()));
