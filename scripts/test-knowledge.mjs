const B = "http://localhost:3000";
async function chat(message, clientId) {
  const r = await (await fetch(B + "/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, clientId }),
  })).json();
  return r.reply;
}

console.log("=== 1) שאלה שהבוט לא יודע ===");
console.log("👤 הגינת ילדים שלכם מקורה או בחוץ?");
console.log("🤖 " + await chat("הגינת ילדים שלכם מקורה או בחוץ?", "kn-" + Date.now()));

await new Promise((r) => setTimeout(r, 500));
const open = await (await fetch(B + "/api/admin/knowledge?status=open")).json();
console.log("\n=== 2) שאלות פתוחות באדמין ===");
open.forEach((q) => console.log(" - " + q.question + "  [id=" + q.id.slice(0, 8) + "]"));

const target = open.find((q) => q.question.includes("גינ") || q.question.includes("מקור"));
if (target) {
  console.log("\n=== 3) הצוות עונה ===");
  await fetch(B + "/api/admin/knowledge/" + target.id, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answer: "הגינה נמצאת בחוץ, באזור פתוח ומוצל עם מתקנים ודמויות לילדים." }),
  });
  console.log("נשמר ✓");

  console.log("\n=== 4) שואלים שוב (שיחה חדשה) - הבוט אמור לדעת עכשיו ===");
  console.log("👤 הגינת ילדים מקורה?");
  console.log("🤖 " + await chat("הגינת ילדים מקורה?", "kn2-" + Date.now()));
} else {
  console.log("\n(לא נמצאה שאלה פתוחה תואמת - ייתכן שהבוט לא תיעד)");
}
