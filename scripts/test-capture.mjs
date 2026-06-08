const B = "http://localhost:3000";
async function chat(message) {
  const r = await (await fetch(B + "/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, clientId: "cap-" + Date.now() + Math.random() }),
  })).json();
  return r.reply;
}
const before = (await (await fetch(B + "/api/admin/knowledge?status=open")).json()).map(q=>q.question);
const qs = [
  "איפה השירותים?",
  "אפשר להפריד את החציל מהטחינה בקרפצ'יו?",
  "כמה עובדים יש אצלכם?",
  "יש שקעים לטעינת לפטופ?",
  "כמה עולה קרואסון שחיתות?", // CONTROL - לא אמור להירשם
];
for (const q of qs) {
  console.log("👤 " + q + "\n🤖 " + (await chat(q)).slice(0,130) + "\n");
}
await new Promise(r=>setTimeout(r,800));
const after = (await (await fetch(B + "/api/admin/knowledge?status=open")).json()).map(q=>q.question);
const added = after.filter(q=>!before.includes(q));
console.log("=== נוספו לפאנל הניהול ===");
added.forEach(q=>console.log(" + " + q));
console.log("\nהקרואסון נרשם? " + (added.some(q=>q.includes("קרואסון")||q.includes("קורסון")) ? "כן (באג!)" : "לא (טוב)"));
