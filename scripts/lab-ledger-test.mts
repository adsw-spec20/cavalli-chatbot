/**
 * בדיקות לפנקס היומיים של טאביט (src/lib/tabit-ledger.ts).
 *
 * הפנקס נולד מממצא קשה (24.9): הארכיון של טאביט מחזיר
 * `400 invalid requested time range (Nh > 24h)` לכל בקשה ארוכה מיממה, ולכן
 * "כמה אי-הגעות היו בשבוע שעבר" היא שאלה שאי אפשר לענות עליה דרכו לעולם.
 * הסוכן צובר את הרשומות אצלנו, והחישוב נעשה כאן.
 *
 * שתי סכנות שנבדקות כאן במיוחד:
 *   דריסה במקום מיזוג - החלון מתגלגל, וכל שליחה מראה חתך אחר של אותו יום.
 *   יום שהתחלנו לתעד באמצעו - הוא נראה שלם ואינו, וזו בדיוק הטעות שהפנקס
 *   נועד למנוע.
 *
 * הרצה: npx tsx scripts/lab-ledger-test.mts   (חינם, בלי רשת ובלי מסד)
 */
import {
  mergeLedgerDay, ledgerIsComplete, computeDayOutcome, computeRevenue, computeSources,
  type LedgerRecord, type LedgerDay,
} from "../src/lib/tabit-ledger";

let pass = 0;
const fails: string[] = [];
const t = (name: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else fails.push(`${name}\n     קיבלנו:  ${JSON.stringify(got)}\n     ציפינו:  ${JSON.stringify(want)}`);
};

const DAY = "2026-09-23";
const at = (s: string) => new Date(`${s}+03:00`).getTime();

const rec = (o: Partial<LedgerRecord> & { id: string }): LedgerRecord => ({
  day: DAY, time: "20:00", name: "לקוח", phone: "0500000000", seats: 2, tables: [1],
  reason: "", walkin: false, source: "אונליין (אתר)", ...o,
});

// ===== מיזוג =====

const first: LedgerDay = mergeLedgerDay(null, DAY, [rec({ id: "a", time: "19:00" })], at(`${DAY}T02:00:00`));
t("יום חדש נוצר", [first.day, first.records.length], [DAY, 1]);
t("זמן הראשייה נשמר", first.firstSeenAt, at(`${DAY}T02:00:00`));

const second = mergeLedgerDay(first, DAY, [rec({ id: "b", time: "21:00" })], at(`${DAY}T22:00:00`));
t("רשומה חדשה נוספת ולא דורסת", second.records.map((r) => r.id), ["a", "b"]);
t("זמן הראשייה לא זז", second.firstSeenAt, at(`${DAY}T02:00:00`));

// ⚠️ הסטטוס משתנה במהלך הערב: הזמנה הופכת ל-no_show רק בסופו.
const third = mergeLedgerDay(second, DAY, [rec({ id: "a", time: "19:00", reason: "no_show" })], at(`${DAY}T23:30:00`));
t("רשומה קיימת מתעדכנת, לא מוכפלת", third.records.length, 2);
t("הסטטוס המעודכן הוא שנשמר", third.records.find((r) => r.id === "a")?.reason, "no_show");

// חלון מתגלגל: שליחה שכבר לא מכילה את הרשומה הישנה לא מוחקת אותה.
const fourth = mergeLedgerDay(third, DAY, [rec({ id: "c", time: "22:00" })], at(`${DAY}T23:59:00`));
t("רשומה שנעלמה מהחלון לא נמחקת", fourth.records.map((r) => r.id).sort(), ["a", "b", "c"]);
t("הרשימה ממוינת לפי שעה", fourth.records.map((r) => r.time), ["19:00", "21:00", "22:00"]);

// ===== אמינות היום =====

t("יום שתועד מלפנות בוקר - אמין", ledgerIsComplete(first), true);
t("יום שהתחלנו לתעד ב-14:00 - לא אמין",
  ledgerIsComplete(mergeLedgerDay(null, DAY, [rec({ id: "x" })], at(`${DAY}T14:00:00`))), false);
t("יום שהתחלנו לתעד ב-05:59 - אמין",
  ledgerIsComplete(mergeLedgerDay(null, DAY, [rec({ id: "x" })], at(`${DAY}T05:59:00`))), true);

// ===== חישוב התוצאה =====

const RECORDS: LedgerRecord[] = [
  rec({ id: "1", reason: "no_show", seats: 10 }),
  rec({ id: "2", reason: "no_show", seats: 2 }),
  rec({ id: "3", reason: "customer_cancelled", seats: 6 }),
  rec({ id: "4", reason: "cancelled", seats: 4 }),
  rec({ id: "5", reason: "", seats: 4, paid_agorot: 48000, tips_agorot: 5000 }),
  rec({ id: "6", reason: "", seats: 3, paid_agorot: 22000, tips_agorot: 2000 }),
  // מזדמנים: לא הזמנות. 12 מתוך 14 רשומות ה-no_show האמיתיות ב-23.9 היו כאלה.
  rec({ id: "7", walkin: true, reason: "no_show", seats: 2, source: "הגעה מהרחוב" }),
  rec({ id: "8", walkin: true, reason: "", seats: 5, source: "הגעה מהרחוב", paid_agorot: 30000 }),
  // רשומה זמנית שפגה - לא נספרת בכלל
  rec({ id: "9", reason: "idle-temp-reservation", seats: 4 }),
  // יום אחר - לא אמור להיכנס לשום ספירה
  rec({ id: "10", day: "2026-09-22", reason: "no_show", seats: 8 }),
];

const out = computeDayOutcome(RECORDS, DAY);
t("הזמנות מראש בלבד", out.booked_total, 6);
t("אי-הגעות: רק הזמנות", out.no_show, 2);
t("ביטולים: גם customer_cancelled וגם cancelled", out.cancelled, 2);
t("הגיעו", out.arrived, 2);
t("מזדמנים נספרים בנפרד", out.walk_ins, 2);
t("אי-הגעות של מזדמנים בנפרד", out.walk_in_no_show, 1);
t("הפירוק מסתכם בסך ההזמנות", out.no_show + out.cancelled + out.arrived, out.booked_total);
t("אחוז אי-הגעה מתוך ההזמנות", out.no_show_rate_pct, 33.3);
t("סועדים שלא הגיעו", out.covers.no_show, 12);
t("רשימת אי-ההגעות שמית", out.no_show_list.map((r) => r.id), ["1", "2"]);
t("יום אחר לא נספר", computeDayOutcome(RECORDS, "2026-09-22").no_show, 1);
t("רשומה זמנית לא נספרת", out.booked_total + out.walk_ins, 8);

// ===== הכנסות =====

const rev = computeRevenue(RECORDS, DAY);
t("רק חשבונות ששולמו נספרים", rev.orders, 3);
t("פדיון בשקלים", rev.revenue_ils, 1000);
t("טיפים בשקלים", rev.tips_ils, 70);
t("ממוצע לחשבון", rev.avg_check_ils, 333.33);
t("אחוז טיפ", rev.tip_pct, 7);

// ===== מקורות =====

const src = computeSources(RECORDS, DAY);
t("סך ההזמנות בפילוח מקורות", src.total, 8);
t("המקור הנפוץ ראשון", src.breakdown[0].source, "אונליין (אתר)");
t("פילוח מסתכם ב-100 אחוז", src.breakdown.reduce((s, b) => s + b.count, 0), 8);

if (fails.length) {
  console.log(`\n${fails.length} נכשלו:\n`);
  for (const f of fails) console.log(`  ❌ ${f}\n`);
}
console.log(`${pass} עברו, ${fails.length} נכשלו`);
process.exit(fails.length ? 1 : 0);
