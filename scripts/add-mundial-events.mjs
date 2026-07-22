/**
 * מוסיף את הקרנות המונדיאל ל-config של הבוט (בפרודקשן), בלי הזנה ידנית בפאנל.
 * הרצה: ADMIN_TOKEN=... node scripts/add-mundial-events.mjs
 * דורש: ADMIN_TOKEN במשתנה סביבה (לא מוטמע בקוד!), ו-BASE (ברירת מחדל = פרודקשן).
 */

const BASE = process.argv[2] || "https://cavalli-chatbot.vercel.app";
const TOKEN = process.env.ADMIN_TOKEN;
if (!TOKEN) {
  console.error("חסר ADMIN_TOKEN במשתני הסביבה. הרצה: ADMIN_TOKEN=... node scripts/add-mundial-events.mjs");
  process.exit(1);
}

// [תאריך, שעה, קבוצה א', קבוצה ב']
const GAMES = [
  ["2026-06-15", "19:00", "ספרד", "כף ורדה"],
  ["2026-06-15", "22:00", "בלגיה", "מצרים"],
  ["2026-06-16", "22:00", "צרפת", "סנגל"],
  ["2026-06-17", "20:00", "פורטוגל", "הרפובליקה הדמוקרטית של קונגו"],
  ["2026-06-17", "23:00", "אנגליה", "קרואטיה"],
  ["2026-06-18", "19:00", "צ׳כיה", "דרום אפריקה"],
  ["2026-06-18", "22:00", "שווייץ", "בוסניה והרצגובינה"],
  ["2026-06-21", "19:00", "ספרד", "ערב הסעודית"],
  ["2026-06-21", "22:00", "בלגיה", "איראן"],
  ["2026-06-22", "22:00", "ארגנטינה", "אוסטריה"],
  ["2026-06-23", "00:00", "צרפת", "עיראק"],
  ["2026-06-23", "20:00", "פורטוגל", "אוזבקיסטן"],
  ["2026-06-23", "23:00", "אנגליה", "גאנה"],
  ["2026-06-24", "22:00", "שווייץ", "קנדה"],
  ["2026-06-24", "22:00", "בוסניה והרצגובינה", "קטאר"],
  ["2026-06-25", "23:00", "אקוואדור", "גרמניה"],
  ["2026-06-25", "23:00", "קורסאו", "חוף השנהב"],
];

const newEvents = GAMES.map(([date, time, teamA, teamB]) => ({
  kind: "screening",
  competition: "מונדיאל",
  teamA,
  teamB,
  date,
  time,
  active: true,
}));

const key = (e) => `${e.date}|${e.time}|${e.teamA}|${e.teamB}`;

const headers = { "x-admin-token": TOKEN, "Content-Type": "application/json" };

// 1) שליפת הקונפיג הנוכחי
const getRes = await fetch(`${BASE}/api/admin/business-config`, { headers });
if (!getRes.ok) {
  console.error("GET נכשל:", getRes.status, await getRes.text());
  process.exit(1);
}
const { config } = await getRes.json();

// 2) מיזוג: משאירים אירועים קיימים שאינם מהרשימה החדשה, ומוסיפים את החדשים (אידמפוטנטי)
const newKeys = new Set(newEvents.map(key));
const existing = (config.events || []).filter((e) => !newKeys.has(key(e)));
config.events = [...existing, ...newEvents];

// 3) שמירה
const putRes = await fetch(`${BASE}/api/admin/business-config`, {
  method: "PUT",
  headers,
  body: JSON.stringify(config),
});
if (!putRes.ok) {
  console.error("PUT נכשל:", putRes.status, await putRes.text());
  process.exit(1);
}

console.log(`✅ נשמרו ${newEvents.length} הקרנות מונדיאל. סה"כ אירועים בקונפיג: ${config.events.length}`);
console.log("דוגמה:", JSON.stringify(config.events.slice(-3), null, 2));
