const B = "http://localhost:3000";
let n = 0;
async function firstMsg(text) {
  const r = await (await fetch(B + "/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: text, clientId: "op2-" + Date.now() + "-" + n++ }),
  })).json();
  return r.reply;
}
for (const g of ["מה נשמע?", "היי", "שלום, מה קורה?", "אהלן"]) {
  console.log(`👤 ${g}\n🤖 ${await firstMsg(g)}\n`);
}
