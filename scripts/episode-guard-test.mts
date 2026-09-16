/**
 * בדיקות ל"לחיצה כפולה" ולגבול הפרק (isDoubleTap ב-conversation-service.ts).
 *
 * התקרית (17.9): הלקוח כתב "היי", קיבל תשובה, **סגר את השיחה**, ושלח "היי"
 * שוב - וקיבל "עניתי ממש כאן למעלה 🙂👆". מבחינתו זו הייתה שיחה חדשה ולא היה
 * שום "למעלה". הסיבה: שיחה סגורה נפתחת מחדש באותו חלון (במכוון, כדי שכל
 * ההיסטוריה של הלקוח תהיה במקום אחד בפאנל), והמעקה לא הכיר את הגבול.
 *
 * הרצה: npx tsx scripts/episode-guard-test.mts   (חינם)
 */
import { isDoubleTap } from "../src/lib/conversation-service";

let pass = 0;
const fails: string[] = [];
const t = (name: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else fails.push(`${name}\n     קיבלנו:  ${JSON.stringify(got)}\n     ציפינו:  ${JSON.stringify(want)}`);
};

const NOW = 1_800_000_000_000;
const m = (role: string, content: string, agoMin: number, meta?: Record<string, unknown>) => ({
  role,
  content,
  ts: NOW - agoMin * 60_000,
  meta,
});

const check = (stored: ReturnType<typeof m>[], episodeStartTs = 0, lastUserTurn = "היי") =>
  isDoubleTap({ stored, lastUserTurn, cannedKey: "greet", episodeStartTs, now: NOW });

// ===== לחיצה כפולה אמיתית =====
const doubleTap = [m("user", "היי", 2), m("assistant", "שלום!", 2, { canned: "greet" })];
t("אותה הודעה תוך שתי דקות = לחיצה כפולה", check(doubleTap), true);

t(
  "אותה הודעה אחרי ארבע דקות - כבר לא",
  check([m("user", "היי", 4), m("assistant", "שלום!", 4, { canned: "greet" })]),
  false
);
t(
  "הודעה אחרת - לא לחיצה כפולה",
  check([m("user", "מה השעות?", 2), m("assistant", "שלום!", 2, { canned: "greet" })], 0, "היי"),
  false
);
t(
  "תבנית אחרת - לא לחיצה כפולה",
  check([m("user", "היי", 2), m("assistant", "אנחנו בחולון", 2, { canned: "location" })]),
  false
);
t("שיחה ריקה", check([]), false);

// ===== גבול הפרק - התקרית עצמה =====
// הלקוח סגר לפני דקה, והסימון reopened נרשם. כל מה שלפניו שייך לפרק אחר.
const reopenTs = NOW - 60_000;
const afterReopen = [
  m("user", "היי", 2),
  m("assistant", "שלום!", 2, { canned: "greet" }),
  m("system", "🔄 הלקוח חזר - השיחה נפתחה מחדש", 1, { activity: true, reopened: true }),
  m("user", "היי", 0),
];
t("אחרי פתיחה מחדש - לא לחיצה כפולה", check(afterReopen, reopenTs), false);
t("ובלי גבול הפרק זה היה נחשב בטעות ככפולה", check(afterReopen, 0), true);

// לחיצה כפולה אמיתית **בתוך** הפרק החדש עדיין נתפסת
t(
  "לחיצה כפולה בתוך הפרק החדש כן נתפסת",
  check(
    [
      m("user", "היי", 10),
      m("assistant", "שלום!", 10, { canned: "greet" }),
      m("system", "🔄 הלקוח חזר", 5, { reopened: true }),
      m("user", "היי", 2),
      m("assistant", "שלום!", 2, { canned: "greet" }),
      m("user", "היי", 0),
    ],
    NOW - 5 * 60_000
  ),
  true
);

// ===== תלונה תמיד מקבלת תשובה מלאה =====
t("'שוב' מקבל תשובה מלאה", check(doubleTap, 0, "היי שוב"), false);
t("'לא עובד' מקבל תשובה מלאה", check(doubleTap, 0, "לא עובד"), false);

// ===== נרמול =====
t(
  "כפילות שורות בהודעה אחת מתאחדת",
  check([m("user", "היי", 2), m("assistant", "שלום!", 2, { canned: "greet" })], 0, "היי\nהיי"),
  true
);

if (fails.length) {
  console.log(`\n${fails.length} נכשלו:\n`);
  for (const f of fails) console.log(`  ❌ ${f}\n`);
}
console.log(`${pass} עברו, ${fails.length} נכשלו`);
process.exit(fails.length ? 1 : 0);
