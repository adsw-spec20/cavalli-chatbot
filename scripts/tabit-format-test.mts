/**
 * בדיקות לפורמט הרשימות של טאביט (src/lib/tabit-format.ts).
 *
 * הפורמט הזה משותף מ-17.9 ללשונית "יום" בפאנל ולצ'אט המעבדה. הבדיקות כאן
 * נועלות שני דברים: שהוא לא משתנה בלי כוונה (הצוות כבר רגיל אליו), ושסינון
 * טווח שעות נעשה נכון - "מהשעה 17:00" החזיר פעם הזמנה אחת במקום כל הרשימה.
 *
 * הרצה: npx tsx scripts/tabit-format-test.mts   (חינם)
 */
import {
  fmtPhoneIL,
  toMinutes,
  waDateParts,
  waResBlock,
  renderReservationList,
  filterByTimeRange,
  scopeNoteFor,
  missingDepositFooter,
  renderByDay,
  mdToWhatsApp,
  type TabitResRow,
} from "../src/lib/tabit-format";
import { enrichDayResult } from "../src/lib/tabit-lab";

let pass = 0;
const fails: string[] = [];
const t = (name: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else fails.push(`${name}\n     קיבלנו:  ${JSON.stringify(got)}\n     ציפינו:  ${JSON.stringify(want)}`);
};

const DAY = "2026-09-17";
const TODAY = "2026-09-17";
const ROWS: TabitResRow[] = [
  { id: "a", name: "דנה לוי", phone: "0501112222", seats: 4, day: DAY, time: "09:30", tables: [12], deposit: "none" },
  { id: "b", name: "שלומי כהן", phone: "972528487546", seats: 6, day: DAY, time: "17:30", tables: [31, 32], deposit: "secured" },
  { id: "c", name: "יונתן", phone: "0533334444", seats: 13, day: DAY, time: "18:30", tables: [69, 70], deposit: "missing", notes: "יום הולדת" },
  { id: "d", name: "", phone: "", seats: 2, day: DAY, time: "20:00", tables: [], deposit: "none" },
];

// ===== עזרים =====
t("טלפון בינלאומי", fmtPhoneIL("972528487546"), "052-848-7546");
t("טלפון מקומי", fmtPhoneIL("0501112222"), "050-111-2222");
t("טלפון לא תקין נשאר כמו שהוא", fmtPhoneIL("1-800-ABC"), "1-800-ABC");
t("דקות", toMinutes("17:30"), 1050);
t("דקות לא תקין", toMinutes(""), -1);
t("שעה פגומה", toMinutes("abc"), -1);
t("שורה בלי שעה לא נבלעת בסינון", filterByTimeRange([...ROWS, { id: "x", name: "ללא שעה", seats: 2, day: DAY, time: "" }], "17:00").map((r) => r.id), ["b", "c", "d", "x"]);
t("היום", waDateParts(DAY, TODAY).ref, "להיום");
t("מחר", waDateParts("2026-09-18", TODAY).ref, "למחר");
t("יום אחר", waDateParts("2026-09-21", TODAY).ref, "ליום שני");
t("תאריך קצר", waDateParts(DAY, TODAY).date, "17.9.26");

// ===== בלוק הזמנה =====
t(
  "בלוק הזמנה מלא",
  waResBlock(ROWS[2]),
  "*18:30 · יונתן · 13 סועדים*\nש׳ 69,70 | 053-333-4444 | ❌ חסר פיקדון\n💬 יום הולדת"
);
t("בלוק בלי שם ובלי שולחן", waResBlock(ROWS[3]), "*20:00 · (ללא שם) · 2 סועדים*\nללא שולחן | - | ללא פיקדון");

// ===== סינון טווח שעות - הבאג המקורי =====
t("מהשעה 17:00 מחזיר את כל מה שאחריה", filterByTimeRange(ROWS, "17:00").map((r) => r.id), ["b", "c", "d"]);
t("עד 18:00", filterByTimeRange(ROWS, undefined, "18:00").map((r) => r.id), ["a", "b"]);
t("בין 17:00 ל-19:00", filterByTimeRange(ROWS, "17:00", "19:00").map((r) => r.id), ["b", "c"]);
t("בלי טווח - הכל", filterByTimeRange(ROWS).length, 4);
t("שעה שאין בה כלום", filterByTimeRange(ROWS, "23:00").length, 0);
t("תיאור טווח - רק from", scopeNoteFor("17:00"), "מ-17:00 ואילך");
t("תיאור טווח - שניהם", scopeNoteFor("17:00", "20:00"), "בין 17:00 ל-20:00");
t("תיאור טווח - כלום", scopeNoteFor(), "");

// ===== הרשימה המלאה =====
const full = renderReservationList({ title: "כל ההזמנות", dayISO: DAY, list: ROWS, todayISO: TODAY });
t("כותרת", full.split("\n")[0], "*כל ההזמנות להיום* (17.9.26)");
t("שורת ספירה", full.split("\n")[1], "4 הזמנות · 25 סועדים");
t("קיבוץ בוקר", full.includes("🌅 *בוקר*"), true);
t("קיבוץ ערב", full.includes("🌆 *ערב*"), true);
t("כל ארבע ההזמנות מופיעות", ["דנה לוי", "שלומי כהן", "יונתן", "(ללא שם)"].every((n) => full.includes(n)), true);
// שורת הסיכום היא האחרונה רק כשאין פיקדונות חסרים; כשיש, האזהרה באה אחריה
t("שורת סיכום", full.trim().split("\n").slice(-2)[0], "*סה״כ:* 4 הזמנות · 25 סועדים");

const ranged = renderReservationList({
  title: "כל ההזמנות",
  dayISO: DAY,
  list: filterByTimeRange(ROWS, "17:00"),
  scopeNote: scopeNoteFor("17:00"),
  todayISO: TODAY,
});
t("כותרת עם טווח", ranged.split("\n")[0], "*כל ההזמנות להיום מ-17:00 ואילך* (17.9.26)");
t("ספירה לפי הטווח", ranged.split("\n")[1], "3 הזמנות · 21 סועדים");
t("הבוקר לא נכנס", ranged.includes("דנה לוי"), false);
// 17:30 נחשב "בוקר" לפי הגבול הקבוע (ערב = 18:00 ומעלה) - אותה מוסכמה בדיוק
// כמו בלשונית "יום", וזו הנקודה: הפורמט זהה ולא "דומה".
t("גבול הערב הוא 18:00, גם ברשימה מסוננת", ranged.includes("🌅 *בוקר*") && ranged.includes("17:30"), true);

const big = renderReservationList({
  title: "שולחנות גדולים",
  dayISO: DAY,
  list: [ROWS[2]],
  summaryNoun: "שולחנות גדולים",
  footer: "❌ 1 הזמנות חסרות פיקדון",
  todayISO: TODAY,
});
t("כותרת גדולים", big.split("\n")[0], "*שולחנות גדולים להיום* (17.9.26)");
t("סיכום גדולים", big.trim().split("\n").slice(-2)[0], "*סה״כ:* 1 שולחנות גדולים · 13 סועדים");
t("שורת זנב", big.trim().split("\n").pop(), "❌ 1 הזמנות חסרות פיקדון");

t(
  "רשימה ריקה לא מייצרת כותרות מדומות",
  renderReservationList({ title: "כל ההזמנות", dayISO: DAY, list: [], todayISO: TODAY }),
  "*כל ההזמנות להיום* (17.9.26)\nאין הזמנות בטווח הזה."
);

// ===== פיקדונות: הגדרה אחת, ולא ספירה של המודל =====
// שלושה מצבים ולא שניים. המודל ערבב בין "חסר" ל"ללא" וכתב 6 במקום 5.
t("סופר רק חסרים", missingDepositFooter(ROWS), "❌ 1 הזמנות חסרות פיקדון");
t("'ללא פיקדון' אינו 'חסר'", missingDepositFooter([ROWS[0], ROWS[3]]), "");
t("אין חסרים - אין שורה", missingDepositFooter([ROWS[1]]), "");
t("אזהרת הפיקדון נכנסת לבלוק אוטומטית", full.includes("❌ 1 הזמנות חסרות פיקדון"), true);
t(
  "שורת זנב מפורשת גוברת על האוטומטית",
  renderReservationList({ title: "כל ההזמנות", dayISO: DAY, list: ROWS, footer: "שורה משלי", todayISO: TODAY }).trim().split("\n").pop(),
  "שורה משלי"
);

// ===== רשימה שפרושה על כמה ימים =====
const multiDay: TabitResRow[] = [
  { id: "p", name: "שני יעקובוב", phone: "0501112222", seats: 2, day: "2026-09-17", time: "20:00", tables: [5], deposit: "secured" },
  { id: "q", name: "שני כהן", phone: "0503334444", seats: 4, day: "2026-09-19", time: "19:00", tables: [7], deposit: "missing" },
];
const byDay = renderByDay(multiDay, { title: "הזמנות שנמצאו", todayISO: TODAY });
t("בלוק לכל יום", (byDay.match(/הזמנות שנמצאו/g) ?? []).length, 2);
t("יום ראשון ברשימה", byDay.includes("*הזמנות שנמצאו להיום* (17.9.26)"), true);
t("יום שני ברשימה", byDay.includes("19.9.26"), true);
t("יום יחיד מרונדר כבלוק אחד", (renderByDay([multiDay[0]], { title: "הזמנות שנמצאו", todayISO: TODAY }).match(/הזמנות שנמצאו/g) ?? []).length, 1);
t("רשימה ריקה מקבלת טקסט ברור", renderByDay([], { title: "הזמנות שנמצאו", emptyText: "לא נמצא." }), "*הזמנות שנמצאו*\nלא נמצא.");

// ===== כפתור "העתק לוואטסאפ": הבלוק המוכן חייב לעבור בלי שריטה =====
// זה מה שהצוות מקבל בפועל בקבוצה. ההמרה נועדה לטבלאות markdown, והיא אסור
// שתיגע בבלוק שכבר נבנה בפורמט וואטסאפ.
t("בלוק מוכן עובר את ההמרה ללא שינוי", mdToWhatsApp(full), full);
t("בלוק עם טווח עובר ללא שינוי", mdToWhatsApp(ranged), ranged);
t("בלוק רב-יומי עובר ללא שינוי", mdToWhatsApp(renderByDay(multiDay, { title: "הזמנות שנמצאו", todayISO: TODAY })), renderByDay(multiDay, { title: "הזמנות שנמצאו", todayISO: TODAY }));
// והיא עדיין עושה את העבודה שלה על טבלה, למקרה שהמודל מחזיר נתונים שאינם הזמנות
t(
  "טבלה עדיין מומרת",
  mdToWhatsApp("| מקור | כמות |\n| --- | --- |\n| אונליין | 12 |").includes("אונליין · 12"),
  true
);
t("מקף ארוך נוקה", mdToWhatsApp("היום — 12 הזמנות"), "היום - 12 הזמנות");

// ===== החיבור למעבדה: מה שהכלי באמת מחזיר למודל =====
// כאן נבדק שהסינון והרינדור אכן קורים בשרשרת של הכלי, ולא רק בפונקציה הטהורה.
const toolOut = enrichDayResult(
  "tabit_read_day",
  { day: DAY, from: "17:00" },
  { day: DAY, source: "snapshot", count: 4, covers: 25, reservations: ROWS }
) as Record<string, unknown>;
t("הכלי מפענח את היום", toolOut.resolved_day, DAY);
t("הכלי מסנן בקוד", (toolOut.reservations as TabitResRow[]).map((r) => r.id), ["b", "c", "d"]);
t("הכלי סופר מחדש אחרי הסינון", [toolOut.count, toolOut.covers], [3, 21]);
t("הכלי מציין את הטווח", toolOut.filtered_range, "מ-17:00 ואילך");
t("הכלי מחזיר רשימה מוכנה להדבקה", String(toolOut.rendered).startsWith("*כל ההזמנות"), true);
t("הרשימה המוכנה לא מכילה את מה שמחוץ לטווח", String(toolOut.rendered).includes("דנה לוי"), false);

const noFilter = enrichDayResult(
  "tabit_read_day",
  { day: DAY },
  { day: DAY, source: "snapshot", count: 4, covers: 25, reservations: ROWS }
) as Record<string, unknown>;
t("בלי טווח - שומר על הספירה של הסוכן", [noFilter.count, noFilter.covers], [4, 25]);
t("בלי טווח - אין תיאור טווח", noFilter.filtered_range, undefined);
t("בלי טווח - עדיין מרנדר", String(noFilter.rendered).includes("דנה לוי"), true);

const deposits = enrichDayResult(
  "tabit_deposit_summary",
  { day: DAY },
  { day: DAY, secured: 2, missing: [ROWS[2]] }
) as Record<string, unknown>;
t("סיכום פיקדונות מקבל רשימה מוכנה", String(deposits.rendered).startsWith("*חסרי פיקדון"), true);
t("סיכום פיקדונות כולל את ההזמנה החסרה", String(deposits.rendered).includes("יונתן"), true);

const summary = enrichDayResult("tabit_covers_summary", { day: DAY }, { day: DAY, count: 4, covers: 25 }) as Record<string, unknown>;
t("כלי סיכום לא מקבל רשימה מרונדרת", summary.rendered, undefined);

if (fails.length) {
  console.log(`\n${fails.length} נכשלו:\n`);
  for (const f of fails) console.log(`  ❌ ${f}\n`);
}
console.log(`${pass} עברו, ${fails.length} נכשלו`);
process.exit(fails.length ? 1 : 0);
