const B = "http://localhost:3000";
async function chat(message, cid, clientId) {
  return (await (await fetch(B + "/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, conversationId: cid, clientId }) })).json()).reply;
}
const t = new Intl.DateTimeFormat("he-IL",{timeZone:"Asia/Jerusalem",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date());
console.log("השעה בישראל עכשיו: " + t + "\n");

console.log("=== ברכה תלוית-שעה ===");
console.log("👤 צהריים טובים\n🤖 " + await chat("צהריים טובים", crypto.randomUUID(), "ph1-"+Date.now()) + "\n");

console.log("=== מגדר (נקבה + בעל) ===");
console.log("👤 היי אני אישה ומגיעה עם בעלי, על מה אתה ממליץ לדייט?\n🤖 " + await chat("היי אני אישה ומגיעה עם בעלי, על מה אתה ממליץ לדייט?", crypto.randomUUID(), "ph2-"+Date.now()));
