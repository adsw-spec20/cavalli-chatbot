const B = "http://localhost:3000";
async function chat(message) {
  const r = await (await fetch(B + "/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, clientId: "nat-" + Date.now() + Math.random() }),
  })).json();
  return r.reply;
}
for (const q of [
  "כמה עולה תספורת?",
  "השער הלבן הגדול של החניה סגור, אתה יכול לפתוח לי אותו?",
]) {
  console.log("👤 " + q + "\n🤖 " + await chat(q) + "\n");
}
