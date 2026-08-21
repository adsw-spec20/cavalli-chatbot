// בדיקת קצה-לקצה של פתיחת שער החניה מהצ'אט.
// הרצה בטוחה (בלי לפתוח שער אמיתי): הוסף ל-.env.local ערכי דמה + מצב יבש:
//   PALGATE_DRY_RUN=1
//   PALGATE_SESSION_TOKEN=000102030405060708090a0b0c0d0e0f
//   PALGATE_PHONE=972500000000
//   PALGATE_TOKEN_TYPE=1
//   PALGATE_DEVICE_ID=TEST
// ואז:  npm run dev   ובמקביל   node scripts/test-gate.mjs
// (אם השרת עלה על פורט אחר, עדכן את BASE למטה.)
//
// מה בודקים: בקשת פתיחה מפורשת -> הבוט קורא לכלי; בשעות הפעילות השער "נפתח"
// (dry-run) והלקוח מקבל אישור, ומחוץ לשעות מוסבר על שעות הפעילות. שאלת חניה
// רגילה -> תשובת מידע בלי פתיחה. חפש בלוג השרת: '[GATE] השער נפתח' / '[GATE] נחסם'.

const BASE = process.env.BASE || "http://localhost:3000";

const cases = [
  { label: "בקשת פתיחה מפורשת", text: "היי, אני בכניסה לחניה, אפשר לפתוח את השער?" },
  { label: "ניסוח קצר", text: "תפתחו את השער בבקשה" },
  { label: "שאלת חניה רגילה (לא פתיחה!)", text: "יש לכם חניה? כמה זה עולה?" },
  { label: "שאלת הגעה (לא פתיחה!)", text: "איך מגיעים לחניה שלכם?" },
];

for (const c of cases) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // כל מקרה כשיחה נפרדת (clientId ייחודי) כדי שלא יתערבבו
    body: JSON.stringify({ message: c.text, clientId: `gate-test-${cases.indexOf(c)}` }),
  });
  const data = await res.json();
  console.log(`\n=== ${c.label} ===`);
  console.log(`👤 ${c.text}`);
  console.log(`🤖 ${data.reply ?? JSON.stringify(data)}`);
}
console.log(
  "\nבדוק בלוג השרת: '[GATE] השער נפתח' (בשעות פעילות) או '[GATE] נחסם' (מחוץ לשעות) - רק בשני המקרים הראשונים."
);
