/**
 * בדיקות לניקוי תשובת המודל (sanitizeModelText ב-conversation-service.ts).
 *
 * כל תיקון כאן נולד מהודעה שיצאה ללקוח אמיתי. הבדיקות נועלות גם את התיקון
 * וגם את מה שאסור לו לשבור - ניסוח תקין שנראה דומה.
 *
 * הרצה: npx tsx scripts/sanitize-test.mts   (חינם)
 */
import { sanitizeModelText } from "../src/lib/conversation-service";

let pass = 0;
const fails: string[] = [];
const t = (name: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else fails.push(`${name}\n     קיבלנו:  ${JSON.stringify(got)}\n     ציפינו:  ${JSON.stringify(want)}`);
};

// ===== "משהו אפשר לעזור" - עברית שבורה שחוזרת =====
t("הצורה הבסיסית", sanitizeModelText("משהו אפשר לעזור?"), "אפשר לעזור במשהו?");
t("עם זנב", sanitizeModelText("משהו אפשר לעזור בו מהתפריט?"), "אפשר לעזור במשהו מהתפריט?");
t("באמצע משפט", sanitizeModelText("בכיף 🙂 משהו אפשר לעזור?"), "בכיף 🙂 אפשר לעזור במשהו?");
t("עם זנב אחר", sanitizeModelText("משהו אפשר לעזור בו היום?"), "אפשר לעזור במשהו היום?");
// ומה שאסור לשבור - ניסוח תקין לגמרי שנראה דומה
t("ניסוח תקין לא נפגע", sanitizeModelText("יש משהו אחר שאוכל לעזור בו?"), "יש משהו אחר שאוכל לעזור בו?");
t("ניסוח תקין שני", sanitizeModelText("אפשר לעזור במשהו נוסף?"), "אפשר לעזור במשהו נוסף?");

// ===== לוכסנים לפני כוכבית/מקף =====
t("לוכסן לפני כוכבית", sanitizeModelText("חייגו \\*8149"), "חייגו *8149");
t("לוכסן לפני מקף", sanitizeModelText("050\\-979"), "050-979");

// ===== תווים שנשברים בערוצים =====
t("חץ מוסר", sanitizeModelText("בוקר → ערב").includes("→"), false);
t("שורות ריקות מרובות", sanitizeModelText("א\n\n\n\nב"), "א\n\nב");

if (fails.length) {
  console.log(`\n${fails.length} נכשלו:\n`);
  for (const f of fails) console.log(`  ❌ ${f}\n`);
}
console.log(`${pass} עברו, ${fails.length} נכשלו`);
process.exit(fails.length ? 1 : 0);
