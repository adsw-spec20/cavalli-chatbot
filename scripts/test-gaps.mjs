const B = "http://localhost:3000";
let cid;
async function send(text, fresh) {
  if (fresh) cid = undefined;
  const r = await (await fetch(B + "/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: text, conversationId: cid, clientId: "gap-" + Date.now() }),
  })).json();
  cid = r.conversationId;
  return r.reply;
}
console.log("=== gluten MID-conversation (was the bug) ===");
await send("היי", true);
console.log("🤖 " + await send("יש מנות ללא גלוטן?") + "\n");

console.log("=== opening year (should log) ===");
console.log("🤖 " + await send("באיזה שנה המקום נפתח?", true));

await new Promise((r) => setTimeout(r, 600));
const open = await (await fetch(B + "/api/admin/knowledge?status=open")).json();
console.log("\n=== open questions in admin now ===");
open.forEach((q) => console.log(" - " + q.question));
