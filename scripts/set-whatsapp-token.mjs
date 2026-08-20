/**
 * הזנה בטוחה של טוקן הוואטסאפ ל-Vercel.
 *
 * למה זה קיים: הדבקה ישירה בטרמינל של Windows מכניסה לפעמים תווים נסתרים
 * (BOM וכד') שהופכים את הטוקן לפגום ("Cannot parse access token").
 * הסקריפט מנקה כל תו שאינו ASCII תקני, מוודא שהטוקן נראה כמו טוקן של מטא,
 * ושומר אותו ב-Vercel בבייטים גולמיים (בלי BOM).
 *
 * הרצה מתיקיית הפרויקט:  node scripts/set-whatsapp-token.mjs
 */
import { execSync } from "child_process";
import { createInterface } from "readline";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

const raw = await ask("הדבק כאן את הטוקן ולחץ Enter:\n> ");
rl.close();

// ניקוי: משאירים רק תווי ASCII מודפסים (אותיות/ספרות/סימנים), בלי רווחים ותווים נסתרים
const token = raw.replace(/[^\x21-\x7e]/g, "");

if (!token.startsWith("EAA") || token.length < 100) {
  console.error(
    `\n❌ זה לא נראה כמו טוקן של מטא (אחרי ניקוי: ${token.length} תווים, מתחיל ב-"${token.slice(0, 4)}").\n` +
      `טוקן תקין מתחיל ב-EAA ואורכו מאות תווים. העתק שוב מהמסך של מטא ונסה שוב.`
  );
  process.exit(1);
}
console.log(`\n✅ הטוקן נקי: ${token.length} תווים, מתחיל ב-EAA. שומר ב-Vercel...`);

const env = { ...process.env, NODE_OPTIONS: "--use-system-ca", NO_UPDATE_NOTIFIER: "1" };
try {
  execSync("npx vercel env rm WHATSAPP_ACCESS_TOKEN production -y", { env, stdio: "ignore" });
} catch {
  /* לא היה קיים - בסדר */
}
execSync("npx vercel env add WHATSAPP_ACCESS_TOKEN production", {
  env,
  input: token, // Node כותב בייטים גולמיים - בלי BOM
  stdio: ["pipe", "inherit", "inherit"],
});
console.log("\n✅ נשמר! עכשיו תגיד ל-Claude לפרוס ולבדוק.");
