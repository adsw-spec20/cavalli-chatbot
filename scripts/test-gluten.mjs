const B = "http://localhost:3000";
let n = 0, cid;
async function send(text) {
  const r = await (await fetch(B + "/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: text, conversationId: cid, clientId: "glu-" + Date.now() }),
  })).json();
  cid = r.conversationId;
  return r.reply;
}
console.log("=== A: first message ===");
console.log("👤 יש מנות ללא גלוטן?\n🤖 " + await send("יש מנות ללא גלוטן?") + "\n");
console.log("=== B: mid-conversation ===");
cid = undefined;
await send("היי");
console.log("👤 (after greeting) יש מנות ללא גלוטן?\n🤖 " + await send("יש מנות ללא גלוטן?"));
