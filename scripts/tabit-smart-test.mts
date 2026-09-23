/**
 * בדיקות יחידה לשכבת האמינות של מעבדת טאביט (tabit-lab-smart).
 * הרצה: npx tsx scripts/tabit-smart-test.mts
 * מכסה בדיוק את שלושת הכשלים שדווחו 15.9 + מקרי קצה.
 */
import {
  weekdayHe, resolveDayISO, calendarBlock, checkOpenAt, addDaysISO,
  nameMatches, phoneMatches, filterRows, todayIL, type LabResRow,
} from "../src/lib/tabit-lab-smart";
import { businessConfig } from "../src/lib/business-config";

let pass = 0, fail = 0;
function t(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log(`✅ ${name}`); }
  else { fail++; console.log(`❌ ${name}`, extra ?? ""); }
}

// ===== הכשל שדווח: 21.9.2026 הוא יום שני, לא ראשון =====
t("21.9.2026 = יום שני (הבאג המקורי)", weekdayHe("2026-09-21") === "שני", weekdayHe("2026-09-21"));
t("20.9.2026 = יום ראשון", weekdayHe("2026-09-20") === "ראשון");
// ⚠️ היה כאן תאריך קבוע (21.9), ולוח השנה מציג 14 ימים **קדימה מהיום** - אז
// הבדיקה פגה מעצמה ברגע שהתאריך עבר. עכשיו היא נגזרת מהיום ולכן תמיד תקפה.
{
  const inThree = addDaysISO(todayIL(), 3);
  t(`לוח השנה כולל את ${inThree} עם היום הנכון`, calendarBlock().includes(`${inThree} = יום ${weekdayHe(inThree)}`));
  t("לוח השנה מתחיל בהיום", calendarBlock().includes(`${todayIL()} = יום ${weekdayHe(todayIL())} (היום)`));
}

// ===== resolveDayISO =====
t("resolveDay ISO עובר כמו שהוא", resolveDayISO("2026-09-21") === "2026-09-21");
t("resolveDay tomorrow = היום + יום", resolveDayISO("tomorrow") === addDaysISO(resolveDayISO("today"), 1));

// ===== הכשל שדווח: זמינות בשעה סגורה (ראשון 18:30, שעות ראשון 08:00-18:00) =====
const cfg = businessConfig;
t("ראשון 18:30 - סגור (הבאג המקורי)", !checkOpenAt(cfg, "2026-09-20", "18:30").open);
t("ראשון 12:00 - פתוח", checkOpenAt(cfg, "2026-09-20", "12:00").open);
t("ראשון 17:00 - פתוח (שעה לפני סגירה)", checkOpenAt(cfg, "2026-09-20", "17:00").open);
t("ראשון 17:30 - סגור (פחות משעה לסגירה)", !checkOpenAt(cfg, "2026-09-20", "17:30").open);
t("שני 18:30 - פתוח (08:00-00:00)", checkOpenAt(cfg, "2026-09-21", "18:30").open);
t("שני 23:00 - פתוח (חצות=24:00, שעה לפני)", checkOpenAt(cfg, "2026-09-21", "23:00").open);
t("שני 23:30 - סגור (פחות משעה לחצות)", !checkOpenAt(cfg, "2026-09-21", "23:30").open);
t("שישי 14:00 - פתוח (08:00-15:00)", checkOpenAt(cfg, "2026-09-25", "14:00").open);
t("שישי 14:30 - סגור", !checkOpenAt(cfg, "2026-09-25", "14:30").open);
t("שבת - סגור כל היום", !checkOpenAt(cfg, "2026-09-26", "12:00").open);
t("checkOpenAt מחזיר יום נכון", checkOpenAt(cfg, "2026-09-21", "18:30").weekday_he === "שני");

// ===== הכשל שדווח: "שני" לא נמצאה =====
t("'שני' מוצא את 'שני יעקובוב'", nameMatches("שני יעקובוב", "שני"));
t("'יעקובוב' מוצא את 'שני יעקובוב'", nameMatches("שני יעקובוב", "יעקובוב"));
t("' שני  ' עם רווחים מוצא", nameMatches("שני יעקובוב", " שני  "));
t("'זוהר' מוצא 'מיכל זוהר-לוי' (מקף)", nameMatches("מיכל זוהר-לוי", "זוהר"));
t("'דני' לא מוצא 'דנה'", !nameMatches("דנה", "דני"));
t("תחילית מילה: 'יעקוב' מוצא 'שני יעקובוב'", nameMatches("שני יעקובוב", "יעקוב"));

// ===== טלפונים =====
t("טלפון עם 972 מול 0", phoneMatches("+972524461628", "0524461628"));
t("6 ספרות אחרונות", phoneMatches("0524461628", "461628"));
t("קצר מדי לא תואם", !phoneMatches("0524461628", "052"));

// ===== הכשל שדווח: שולחנות 69/70 =====
const rows: LabResRow[] = [
  { id: "1", name: "סיגל", phone: "0526560242", seats: 20, day: "2026-09-16", time: "19:00", tables: [70, 69], deposit: "secured" },
  { id: "2", name: "שני יעקובוב", phone: "0543273717", seats: 15, day: "2026-09-17", time: "19:30", tables: [2], deposit: "secured" },
  { id: "3", name: "מבוטלת", phone: "050", seats: 4, day: "2026-09-16", time: "20:00", tables: [69], state: "cancelled" },
  { id: "4", name: "אשר", phone: "0509800096", seats: 25, day: "2026-09-18", time: "20:00", tables: [1], deposit: "missing" },
];
t("שולחן 69 מוצא את סיגל (סדר [70,69])", filterRows(rows, { tables: [69] }).length === 1 && filterRows(rows, { tables: [69] })[0].name === "סיגל");
t("שולחנות [69,70] מוצאים הזמנה אחת (לא כפול)", filterRows(rows, { tables: [69, 70] }).length === 1);
t("מבוטלת לא נספרת", filterRows(rows, { tables: [69], day: "2026-09-16" }).every((r) => r.state !== "cancelled"));
t("סינון יום: שני יעקובוב רק ב-17.9", filterRows(rows, { name: "שני" }).length === 1 && filterRows(rows, { name: "שני", day: "2026-09-16" }).length === 0);
t("שם+שולחן משולב", filterRows(rows, { name: "סיגל", tables: [70] }).length === 1);

console.log(`\n${fail === 0 ? "🎉" : "⚠"} ${pass} עברו, ${fail} נכשלו`);
process.exit(fail === 0 ? 0 : 1);
