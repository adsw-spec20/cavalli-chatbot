// בדיקת הפריסה החיה. הרצה: node scripts/test-live.mjs <URL> [ADMIN_TOKEN]
const URL = process.argv[2];
const TOKEN = process.argv[3];

const home = await fetch(URL);
console.log("home status:", home.status);

const chat = await fetch(URL + "/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message: "מה השעות שלכם?", clientId: "live-test-1" }),
});
console.log("chat status:", chat.status);
const cj = await chat.json().catch(() => null);
console.log("chat reply:", cj?.reply ? cj.reply.slice(0, 140) : JSON.stringify(cj));

const st = await fetch(URL + "/api/admin/stats", {
  headers: TOKEN ? { "x-admin-token": TOKEN } : {},
});
console.log("stats status:", st.status);
const sj = await st.json().catch(() => null);
console.log("stats:", sj ? JSON.stringify(sj).slice(0, 200) : "(none)");
