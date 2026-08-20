/**
 * מפיק Page Access Token קבוע (שלא פג לעולם) למסנג'ר/אינסטגרם.
 *
 * ⚠️ הסודות נשארים אצלך במחשב - הם עוברים רק למטא, לא לשום מקום אחר.
 *
 * הרצה (Bash):
 *   APP_SECRET=xxx SHORT_TOKEN=yyy node scripts/get-permanent-token.mjs
 *
 * להגדרה אוטומטית גם ב-Vercel, הוסף --set-vercel:
 *   APP_SECRET=xxx SHORT_TOKEN=yyy node scripts/get-permanent-token.mjs --set-vercel
 *
 * מה זה עושה:
 *  1. ממיר את טוקן המשתמש קצר-הטווח לטוקן ארוך-טווח.
 *  2. מושך ממנו את טוקן העמוד של קפה קוואלי (טוקן כזה לא פג).
 *  3. מאמת מול מטא שהוא באמת "never expires".
 *  4. (אופציונלי) מגדיר אותו ב-Vercel ומזכיר לפרוס.
 */

import { execSync } from "child_process";

const V = "v21.0";
const APP_ID = process.env.APP_ID || "1499744815172250";
const PAGE_ID = process.env.PAGE_ID || "927062900493215"; // Caffe cavalli קפה קוואלי
const APP_SECRET = process.env.APP_SECRET;
const SHORT_TOKEN = process.env.SHORT_TOKEN;
const SET_VERCEL = process.argv.includes("--set-vercel");

if (!APP_SECRET || !SHORT_TOKEN) {
  console.error(`
❌ חסרים משתני סביבה.

הרצה נכונה (ב-Bash):
  APP_SECRET=הסוד_שלך SHORT_TOKEN=הטוקן_מה־explorer node scripts/get-permanent-token.mjs

  APP_SECRET  = App settings > Basic > App secret (לחיצה על Show)
  SHORT_TOKEN = הטוקן מ-Graph API Explorer (אייקון ההעתקה)
`);
  process.exit(1);
}

const api = async (path, label) => {
  const res = await fetch(`https://graph.facebook.com/${V}${path}`);
  const data = await res.json();
  if (!res.ok || data.error) {
    console.error(`❌ ${label} נכשל:`, data.error?.message || JSON.stringify(data));
    process.exit(1);
  }
  return data;
};

// ---- 1. המרה לטוקן משתמש ארוך-טווח ----
console.log("1/4  ממיר לטוקן ארוך-טווח...");
const longRes = await api(
  `/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}` +
    `&client_secret=${encodeURIComponent(APP_SECRET)}` +
    `&fb_exchange_token=${encodeURIComponent(SHORT_TOKEN)}`,
  "המרת הטוקן"
);
const longToken = longRes.access_token;
console.log("     ✅ התקבל טוקן משתמש ארוך-טווח");

// ---- 2. שליפת טוקן העמוד ----
console.log("2/4  מושך את טוקן העמוד...");
const accounts = await api(
  `/me/accounts?access_token=${encodeURIComponent(longToken)}`,
  "שליפת העמודים"
);
const page = (accounts.data || []).find((p) => p.id === PAGE_ID);
if (!page) {
  console.error(`
❌ העמוד ${PAGE_ID} לא נמצא ברשימת העמודים שלך.
   עמודים שנמצאו: ${(accounts.data || []).map((p) => `${p.name} (${p.id})`).join(", ") || "(אין)"}
   ודא שאתה אדמין של עמוד קפה קוואלי עם אותו חשבון שיצר את הטוקן.
`);
  process.exit(1);
}
const pageToken = page.access_token;
console.log(`     ✅ נמצא: ${page.name}`);

// ---- 3. אימות שהטוקן לא פג ----
console.log("3/4  מאמת מול מטא שהטוקן קבוע...");
const dbg = await api(
  `/debug_token?input_token=${encodeURIComponent(pageToken)}` +
    `&access_token=${APP_ID}|${encodeURIComponent(APP_SECRET)}`,
  "אימות הטוקן"
);
const expires = dbg.data?.expires_at;
const neverExpires = expires === 0 || expires === undefined;
console.log(
  neverExpires
    ? "     ✅ הטוקן לא פג לעולם (expires_at = 0)"
    : `     ⚠️ שים לב: הטוקן פג בתאריך ${new Date(expires * 1000).toLocaleString("he-IL")}`
);
console.log(`     הרשאות: ${(dbg.data?.scopes || []).join(", ")}`);

// ---- 4. הדפסה / הגדרה ב-Vercel ----
console.log("\n" + "=".repeat(60));
console.log("🔑 טוקן העמוד הקבוע:\n");
console.log(pageToken);
console.log("=".repeat(60) + "\n");

if (SET_VERCEL) {
  const env = { ...process.env, NODE_OPTIONS: "--use-system-ca", NO_UPDATE_NOTIFIER: "1" };
  for (const name of ["MESSENGER_PAGE_ACCESS_TOKEN", "INSTAGRAM_PAGE_ACCESS_TOKEN"]) {
    console.log(`4/4  מגדיר ${name} ב-Vercel...`);
    try {
      execSync(`vercel env rm ${name} production -y`, { env, stdio: "ignore" });
    } catch {
      /* לא היה קיים - בסדר */
    }
    execSync(`vercel env add ${name} production`, {
      env,
      input: pageToken, // בלי BOM - Node כותב בייטים גולמיים
      stdio: ["pipe", "ignore", "inherit"],
    });
    console.log(`     ✅ ${name} עודכן`);
  }
  console.log(`
✅ סיימנו! נשאר רק לפרוס כדי שהטוקן החדש ייכנס לתוקף:

   NODE_OPTIONS=--use-system-ca vercel deploy --prod --yes --force
`);
} else {
  console.log(`להגדרה אוטומטית ב-Vercel, הרץ שוב עם --set-vercel:

  APP_SECRET=... SHORT_TOKEN=... node scripts/get-permanent-token.mjs --set-vercel
`);
}
