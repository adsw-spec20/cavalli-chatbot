/**
 * סוויטת בדיקות (eval) - הביטוח נגד רגרסיות.
 * מריצה עשרות שאלות מגוונות מול הבוט ובודקת כל תשובה מול כללים.
 * הרצה: node scripts/eval.mjs   (מול השרת המקומי על :3000)
 *
 * מטרה: לתפוס באופן שיטתי "ביטויים ושאלות שמשתבשים", כמו שביקש המשתמש.
 */

const B = process.argv[2] || "http://localhost:3000";

// כללים שחלים על *כל* תשובה
const GLOBAL_FORBIDDEN = [
  { p: "—", why: "em-dash אסור" },
  { p: "\\*", why: "לוכסן אחורי לפני כוכבית" },
  { p: "\\-", why: "לוכסן אחורי לפני מקף" },
  { p: "הכל פתוח", why: "ביטוי שיווקי מלאכותי" },
  { p: "בא לנכון", why: "צירוף לא תקין" },
  { p: "맛", why: "תו זר שדלף" },
];

// סימן ל"ברכה גנרית במקום תשובה"
const GREETING_SIG = "אז איך אפשר לעזור";

// כל הדרכים שבהן הבוט מאותת "אין לי תשובה מלאה" (לבדיקת מקרי פער)
const GAP_SIGNALS = [
  "צוות", "אין לי", "לא מופיע", "לא יודע", "לא בטוח", "בוודאות",
  "ברר", "אנחש", "לבדוק", "לשאול", "8149",
];

const CASES = [
  { name: "ברכה", turns: ["היי"], includeAny: ["קוואלי"], greetingOk: true },
  { name: "מחיר קרואסון", turns: ["כמה עולה קרואסון שחיתות?"], includeAny: ["72"] },
  { name: "מחיר קפוצ'ינו", turns: ["כמה עולה קפוצ'ינו?"], includeAny: ["14", "16"] },
  { name: "חניה", turns: ["יש חניה?"], includeAny: ["חני", "waze", "Waze"] },
  { name: "שבת", turns: ["אתם פתוחים בשבת?"], includeAny: ["סגור"] },
  { name: "יין בכוס", turns: ["יש יין אדום בכוס?"], includeAny: ["טרה נגרה", "49", "51"] },
  { name: "כשרות", turns: ["אתם כשרים?"], includeAny: ["בית יוסף", "חלבי", "כשר"] },
  { name: "טייק אווי", turns: ["אפשר טייק אווי?"], includeAny: ["טייק", "כן"] },
  { name: "ילדים חכם", turns: ["אני מגיע עם ילדים, מה לאכול חוץ מפסטה?"], includeAny: ["פיצה", "צ'יפס", "פיש"] },
  { name: "גלוטן באמצע שיחה", turns: ["היי", "יש מנות ללא גלוטן?"], includeAny: GAP_SIGNALS.concat(["גלוטן"]), exclude: [GREETING_SIG] },
  { name: "שגיאת כתיב", turns: ["כמה עולה קורסון?"], includeAny: ["72"] },
  { name: "שאלה לא ידועה", turns: ["באיזה שנה המקום נפתח?"], includeAny: GAP_SIGNALS },
  { name: "מחוץ לתחום - אייפל", turns: ["מה הגובה של מגדל אייפל?"], includeAny: ["קוואלי", "בית הקפה", "חולון", "תפריט"], exclude: ["330 מטר", "324 מטר"] },
  { name: "מחוץ לתחום - טריוויה", turns: ["מי ראש ממשלת צרפת?"], includeAny: ["קוואלי", "בית הקפה", "חולון", "תפריט"] },
  { name: "מחוץ לתחום - תספורת", turns: ["כמה עולה תספורת?"], includeAny: ["קוואלי", "קפה", "תפריט"] },
  { name: "רגיש", turns: ["יש לי כאבים חזקים בחזה"], includeAny: ["101", "רפוא", "רופא"] },
  { name: "הסלמה - תלונה", turns: ["אני רוצה להתלונן על שירות גרוע מאוד"], includeAny: ["צוות", "נציג", "8149"] },
  { name: "פתוחים עכשיו", turns: ["אתם פתוחים עכשיו?"], includeAny: ["פתוח", "סגור"] },
  { name: "שירותים (פער קטן)", turns: ["איפה השירותים?"], includeAny: GAP_SIGNALS.concat(["בהגעה"]) },
  { name: "שינוי מנה (פער קטן)", turns: ["אפשר להפריד את החציל מהטחינה?"], includeAny: GAP_SIGNALS },
  { name: "מספר עובדים (פער קטן)", turns: ["כמה עובדים יש אצלכם?"], includeAny: GAP_SIGNALS },
];

async function send(text, conversationId, clientId) {
  const r = await fetch(B + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: text, conversationId, clientId }),
  });
  return r.json();
}

let passed = 0;
let failed = 0;
const failures = [];

for (let i = 0; i < CASES.length; i++) {
  const c = CASES[i];
  const clientId = "eval-" + Date.now() + "-" + i;
  let conversationId;
  let reply = "";
  for (const t of c.turns) {
    const res = await send(t, conversationId, clientId);
    conversationId = res.conversationId;
    reply = res.reply || "";
  }

  const problems = [];

  for (const g of GLOBAL_FORBIDDEN) {
    if (reply.includes(g.p)) problems.push(`מכיל אסור (${g.why})`);
  }
  // קול מילוי "הה"/"אהה" כמילה עצמאית
  if (/(^|[\s,.!])(הה|אהה)([\s,.!]|$)/.test(reply)) {
    problems.push("קול מילוי (הה/אהה)");
  }
  // מילת יחס תלויה בסוף שורה (למשל "...לעזור עם" עם אימוג'י/נקודה אחריו)
  const firstLineHe = reply.split("\n")[0].replace(/[^֐-׿]+$/u, "");
  if (firstLineHe.endsWith("לעזור עם") || firstLineHe.endsWith("אני כאן על")) {
    problems.push("מילת יחס תלויה/שגויה");
  }
  if (!c.greetingOk && reply.includes(GREETING_SIG)) {
    problems.push("ברכה גנרית במקום תשובה");
  }
  if (c.includeAny && !c.includeAny.some((s) => reply.includes(s))) {
    problems.push(`חסר אחד מ: [${c.includeAny.join(", ")}]`);
  }
  if (c.exclude) {
    for (const s of c.exclude) {
      if (reply.includes(s)) problems.push(`מכיל מה שאסור: "${s}"`);
    }
  }
  if (reply.trim().length < 3) problems.push("תשובה ריקה");

  if (problems.length === 0) {
    passed++;
    console.log(`✅ ${c.name}`);
  } else {
    failed++;
    console.log(`❌ ${c.name} -> ${problems.join(" | ")}`);
    failures.push({ name: c.name, reply, problems });
  }
}

console.log(`\n===== ${passed}/${CASES.length} עברו, ${failed} נכשלו =====`);
if (failures.length) {
  console.log("\nפירוט כשלונות:");
  for (const f of failures) {
    console.log(`\n• ${f.name}`);
    console.log(`  בעיות: ${f.problems.join(" | ")}`);
    console.log(`  תשובה: ${f.reply.slice(0, 160)}`);
  }
  process.exit(1);
}
