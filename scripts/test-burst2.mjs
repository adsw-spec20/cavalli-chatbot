const B = "http://localhost:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function send(message, cid, clientId) {
  return (await fetch(B + "/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, conversationId: cid, clientId }) })).json();
}
for (let trial = 1; trial <= 3; trial++) {
  const cid = crypto.randomUUID();
  const clientId = "b2-" + Date.now() + "-" + trial;
  const p1 = send("היי", cid, clientId);
  await sleep(300);
  const p2 = send("איך מגיעים לחניה?", cid, clientId);
  const [r1, r2] = await Promise.all([p1, p2]);
  const replies = [r1.reply, r2.reply].filter(Boolean);
  const both = replies[0] && replies[0].includes("חניה") || replies[0]?.includes("Waze") || replies[0]?.includes("המלאכה");
  console.log(`ניסיון ${trial}: מספר תשובות לא-ריקות=${replies.length} | מתייחסת לחניה? ${both ? "כן" : "לא"}`);
}
