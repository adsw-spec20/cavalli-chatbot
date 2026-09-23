/**
 * בדיקות לבקשת התפריט (matchQuickAnswers + fullMenuAnswer).
 *
 * התקלה (23.9): לקוחות שביקשו "את התפריט המלא" קיבלו "סליחה, יש לי תקלה
 * טכנית". לא הייתה שום תקלה - המודל התבקש להקליד מחדש 3,400 תווים של תפריט,
 * חרג מ-MAX_TOKENS ומה-timeout, והבקשה נקטעה. התפריט נבנה עכשיו בקוד.
 *
 * הרצה: npx tsx scripts/menu-test.mts   (חינם)
 */
import { matchQuickAnswers, fullMenuAnswer } from "../src/lib/conversation-service";
import { businessConfig as cfg } from "../src/lib/business-config";

let pass = 0;
const fails: string[] = [];
const t = (name: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else fails.push(`${name}\n     קיבלנו:  ${JSON.stringify(got)}\n     ציפינו:  ${JSON.stringify(want)}`);
};

// ===== הניסוחים שנפלו בפועל =====
t("הניסוח מהתקלה", matchQuickAnswers("היי שלח לי את התפריט המלא"), ["menuFull"]);
t("בלי ברכה", matchQuickAnswers("שלח לי את התפריט המלא"), ["menuFull"]);
t("ואני רוצה את התפריט המלא", matchQuickAnswers("ואני רוצה את התפריט המלא"), ["menuFull"]);
t("כל התפריט", matchQuickAnswers("אפשר לקבל את כל התפריט?"), ["menuFull"]);
t("תפריט מלא בלי ה'", matchQuickAnswers("תפריט מלא בבקשה"), ["menuFull"]);
t("אנגלית", matchQuickAnswers("can I get the full menu"), ["menuFull"]);

// ===== והבקשה הרגילה נשארה על הקטגוריות =====
t("תפריט סתם", matchQuickAnswers("אפשר תפריט?"), ["menu"]);
t("שלח לי תפריט", matchQuickAnswers("שלח לי תפריט"), ["menu"]);
t("מה יש לכם בתפריט", matchQuickAnswers("מה יש לכם בתפריט"), ["menu"]);

// ===== בקשה ספציפית לא נחטפת לאף אחת מהן =====
t("קטגוריה ספציפית", matchQuickAnswers("מה יש בתפריט לילדים?"), []);
t("שאלת גלוטן", matchQuickAnswers("יש בתפריט משהו ללא גלוטן?"), []);

// ===== התפריט עצמו =====
const full = fullMenuAnswer(cfg)!;
const available = cfg.menu.flatMap((c) => c.items.filter((i) => i.available !== false));
t("כל הפריטים הזמינים מופיעים", available.every((i) => full.includes(i.name)), true);
t("כל הקטגוריות מופיעות", cfg.menu.every((c) => full.includes(`*${c.name}*`)), true);
t("פריט שאזל לא מופיע", cfg.menu.flatMap((c) => c.items).filter((i) => i.available === false).every((i) => !full.includes(i.name)), true);
// מגבלת הודעה בוואטסאפ - הסיבה שאפשר לשלוח את זה בהודעה אחת
t("נכנס בהודעה אחת בוואטסאפ", full.length < 4096, true);
t("הערת קטגוריה נשמרת", full.includes("תוספות לבחירה"), true);
t("מחיר טקסטואלי נשמר כמו שהוא", full.includes("יחיד ₪89 / זוגי ₪159"), true);
t("בלי מקף ארוך", full.includes("—"), false);

if (fails.length) {
  console.log(`\n${fails.length} נכשלו:\n`);
  for (const f of fails) console.log(`  ❌ ${f}\n`);
}
console.log(`${pass} עברו, ${fails.length} נכשלו`);
process.exit(fails.length ? 1 : 0);
