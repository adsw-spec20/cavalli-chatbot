const B = "http://localhost:3000";
async function chat(message, clientId) {
  const r = await (await fetch(B + "/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, clientId }),
  })).json();
  return r.reply;
}
console.log("=== 3) שעות בלי 'להשוויץ' ביום ===");
console.log("👤 אתם פתוחים עכשיו?");
console.log("🤖 " + await chat("אתם פתוחים עכשיו?", "fx-" + Date.now()) + "\n");

console.log("=== 2) פער בפרט ספציפי - אמור להירשם ===");
console.log("👤 איזה דמויות ומתקנים יש בגינת הילדים?");
console.log("🤖 " + await chat("איזה דמויות ומתקנים יש בגינת הילדים?", "fx2-" + Date.now()));

await new Promise((r) => setTimeout(r, 600));
const open = await (await fetch(B + "/api/admin/knowledge?status=open")).json();
console.log("\nשאלות פתוחות באדמין כעת:");
open.forEach((q) => console.log(" - " + q.question));
