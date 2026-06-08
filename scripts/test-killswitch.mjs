const B = "http://localhost:3000";
async function setBot(on) {
  await fetch(B + "/api/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ botEnabled: on }) });
}
async function chat(message) {
  const r = await (await fetch(B + "/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, clientId: "ks-" + Date.now() }) })).json();
  return r.reply;
}
await setBot(false);
console.log("בוט כבוי -> reply: " + JSON.stringify(await chat("מה השעות?")));
await setBot(true);
console.log("בוט פעיל -> reply: " + (await chat("מה השעות?"))?.slice(0, 50));
const s = await (await fetch(B + "/api/admin/settings")).json();
console.log("settings:", JSON.stringify(s));
