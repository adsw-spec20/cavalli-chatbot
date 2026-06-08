const B = "http://localhost:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cid = crypto.randomUUID();
const clientId = "burst-" + Date.now();
async function send(message) {
  const r = await (await fetch(B + "/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, conversationId: cid, clientId }),
  })).json();
  return r;
}
console.log("שולח 'היי' ואז 250ms אחרי 'איך מגיעים לחניה?' (בלי לחכות)...");
const p1 = send("היי");
await sleep(250);
const p2 = send("איך מגיעים לחניה?");
const [r1, r2] = await Promise.all([p1, p2]);
console.log("\nתשובה להודעה 1 (אמורה להיות null - הוחלפה):", JSON.stringify(r1.reply));
console.log("\nתשובה להודעה 2 (אמורה להיות אחת קוהרנטית על שתיהן):\n🤖 " + r2.reply);
