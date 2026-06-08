const B = "http://localhost:3000";
let n = 0, cid;
async function send(text) {
  const r = await (await fetch(B + "/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: text, conversationId: cid, clientId: "smart-" + Date.now() }),
  })).json();
  cid = r.conversationId;
  return r.reply;
}
console.log("👤 אני מגיע עם ילדים קטנים, מה יש להם לאכול חוץ מפסטה?");
console.log("🤖 " + await send("אני מגיע עם ילדים קטנים, מה יש להם לאכול חוץ מפסטה?"));
