/**
 * בדיקות ל"מצב המסעדה כרגע" (openStateAt / openStateLine ב-business-hours.ts).
 *
 * הרקע: ב-00:03 הבוט כתב ללקוח "בא לך לבוא? פתוחים עד חצות". כאן נבדק שהקוד
 * מחזיר את האמת בכל הרגעים הרגישים - סביב חצות, סביב ההושבה האחרונה, ובימים
 * שבהם נסגרים מוקדם. הרצה: npx tsx scripts/open-state-test.mts  (חינם)
 */
import { businessConfig } from "../src/lib/business-config";
import { openStateAt, openStateLine, lastSeatingForDate } from "../src/lib/business-hours";
import { withHoursDefaults } from "../src/lib/business-config-store";

let pass = 0;
const fails: string[] = [];
const t = (name: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else fails.push(`${name}\n     קיבלנו:  ${JSON.stringify(got)}\n     ציפינו:  ${JSON.stringify(want)}`);
};
const il = (iso: string, hhmm: string) => new Date(`${iso}T${hhmm}:00+03:00`).getTime();
const cfg = businessConfig;
const at = (iso: string, hhmm: string) => openStateAt(cfg, il(iso, hhmm));

// ספטמבר 2026: 13 ראשון · 14 שני · 15 שלישי · 16 רביעי · 17 חמישי · 18 שישי · 19 שבת

// ===== סביב חצות - התקרית עצמה =====
const thu0003 = at("2026-09-17", "00:03");
t("00:03 סגור", thu0003.open, false);
t("00:03 לא 'עבר ההושבה' אלא סגור", thu0003.pastLastSeating, false);
t("00:03 הפתיחה הבאה היום ב-08:00", thu0003.nextOpening, "היום ב-08:00");
t("00:03 השורה אומרת סגור", openStateLine(cfg, il("2026-09-17", "00:03")).includes("**סגור**"), true);
t("00:03 השורה אוסרת להזמין להגיע", openStateLine(cfg, il("2026-09-17", "00:03")).includes("אסור להזמין"), true);
t("23:59 עדיין פתוח", at("2026-09-16", "23:59").open, true);
t("00:00 בדיוק כבר סגור", at("2026-09-17", "00:00").open, false);
t("08:00 בדיוק פתוח", at("2026-09-17", "08:00").open, true);
t("07:59 סגור", at("2026-09-17", "07:59").open, false);

// ===== הושבה אחרונה (שני-חמישי בלבד) =====
t("חמישי 22:00 פתוח ולפני ההושבה", [at("2026-09-17", "22:00").open, at("2026-09-17", "22:00").pastLastSeating], [true, false]);
t("חמישי 23:00 בדיוק - עבר", at("2026-09-17", "23:00").pastLastSeating, true);
t("חמישי 23:10 - עבר", at("2026-09-17", "23:10").pastLastSeating, true);
t("חמישי - שעת ההושבה", at("2026-09-17", "22:00").lastSeating, "23:00");
t("שני - שעת ההושבה", at("2026-09-14", "22:00").lastSeating, "23:00");
t("ראשון - אין הושבה אחרונה", at("2026-09-13", "17:00").lastSeating, null);
t("שישי - אין הושבה אחרונה", at("2026-09-18", "14:00").lastSeating, null);
t("שישי 14:50 פתוח בלי אזהרת הושבה", [at("2026-09-18", "14:50").open, at("2026-09-18", "14:50").pastLastSeating], [true, false]);
t(
  "אחרי ההושבה האחרונה - השורה אוסרת במפורש",
  openStateLine(cfg, il("2026-09-17", "23:20")).includes("אסור להזמין אף אחד להגיע עכשיו"),
  true
);
t(
  "לפני ההושבה האחרונה - השורה רק מציינת אותה",
  openStateLine(cfg, il("2026-09-17", "21:00")).includes("ההושבה האחרונה היום: 23:00"),
  true
);

// ===== ימים שסוגרים מוקדם / סגורים =====
t("שישי 15:30 סגור", at("2026-09-18", "15:30").open, false);
t("שישי 15:30 - נפתחים ביום ראשון", at("2026-09-18", "15:30").nextOpening, "יום ראשון 20.9 ב-08:00");
t("שבת סגורים לגמרי", at("2026-09-19", "12:00").hoursToday, null);
t("שבת - נפתחים ביום ראשון", at("2026-09-19", "12:00").nextOpening, "יום ראשון 20.9 ב-08:00");
t("שבת - השורה אומרת סגורים לגמרי", openStateLine(cfg, il("2026-09-19", "12:00")).includes("היום סגורים לגמרי"), true);
t("ראשון 18:30 סגור", at("2026-09-13", "18:30").open, false);
t("ראשון 18:30 - נפתחים מחר", at("2026-09-13", "18:30").nextOpening, "יום שני 14.9 ב-08:00");
t("ראשון 17:00 פתוח", at("2026-09-13", "17:00").open, true);

// ===== דריסת שעות נקודתית =====
const special = {
  ...cfg,
  hoursOverrides: [{ date: "2026-09-19", hours: "20:00-23:00", lastSeating: "22:00", note: "אירוע" }],
};
t("דריסה - פתוח בשבת חריגה", openStateAt(special, il("2026-09-19", "21:00")).open, true);
t("דריסה - הושבה אחרונה משלה", lastSeatingForDate(special, "2026-09-19"), "22:00");
t("דריסה - אחרי ההושבה", openStateAt(special, il("2026-09-19", "22:30")).pastLastSeating, true);

// ===== השלמת השדה החדש על קונפיג שנשמר מהפאנל =====
// ⚠️ זה מה שמחליט אם הפיצ'ר בכלל עובד בפרודקשן: המיזוג ב-loadBusinessConfig
// רדוד, ולכן מערך השעות ששמור ב-DB דורס את זה שבקוד. בלי ההשלמה הזאת השדה
// החדש פשוט לא היה מגיע ללקוחות - והכל היה נראה תקין מקומית.
const savedFromPanel = {
  ...cfg,
  hours: [
    { day: "ראשון", hours: "08:00-18:00" },
    { day: "שני", hours: "08:00-00:00" },
    { day: "שלישי", hours: "08:00-00:00" },
    { day: "רביעי", hours: "08:00-00:00" },
    { day: "חמישי", hours: "08:00-00:00" },
    { day: "שישי", hours: "08:00-15:00" },
    { day: "שבת", hours: null },
  ],
};
const healed = withHoursDefaults(savedFromPanel);
t("קונפיג שמור בלי השדה - מושלם משני עד חמישי", healed.hours.map((h) => h.lastSeating ?? null), [null, "23:00", "23:00", "23:00", "23:00", null, null]);
t("אחרי ההשלמה החישוב עובד", openStateAt(healed, il("2026-09-17", "23:20")).pastLastSeating, true);

// בחירה מפורשת של בעל העסק לא נדרסת על ידי ההשלמה
const ownerCleared = { ...cfg, hours: cfg.hours.map((h) => (h.day === "שני" ? { ...h, lastSeating: null } : h)) };
t("null מפורש נשמר", withHoursDefaults(ownerCleared).hours.find((h) => h.day === "שני")?.lastSeating, null);
const ownerChanged = { ...cfg, hours: cfg.hours.map((h) => (h.day === "שני" ? { ...h, lastSeating: "22:30" } : h)) };
t("ערך שנערך נשמר", withHoursDefaults(ownerChanged).hours.find((h) => h.day === "שני")?.lastSeating, "22:30");

if (fails.length) {
  console.log(`\n${fails.length} נכשלו:\n`);
  for (const f of fails) console.log(`  ❌ ${f}\n`);
}
console.log(`${pass} עברו, ${fails.length} נכשלו`);
process.exit(fails.length ? 1 : 0);
