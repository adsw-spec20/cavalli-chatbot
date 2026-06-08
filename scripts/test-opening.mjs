const B = "http://localhost:3000";
let n = 0;
async function firstMsg(text) {
  const r = await (await fetch(B + "/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: text, clientId: "open-" + Date.now() + "-" + n++ }),
  })).json();
  return r.reply;
}
console.log("1) 'היי אשמח לדעת איך מגיעים לחניה':\n🤖 " + await firstMsg("היי אשמח לדעת איך מגיעים לחניה") + "\n");
console.log("2) 'כמה עולה קרואסון?':\n🤖 " + await firstMsg("כמה עולה קרואסון?") + "\n");
console.log("3) 'היי' (ברכה בלבד):\n🤖 " + await firstMsg("היי"));
