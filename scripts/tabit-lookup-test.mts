/**
 * בדיקות לזיהוי הזמנה מול יומן טאביט (src/lib/tabit-lookup.ts).
 *
 * הפיצ'ר הזה נוגע בפרטיות של לקוחות אמיתיים: טעות כאן פירושה שאדם זר מקבל
 * את השם, התאריך והשעה של מישהו אחר על סמך מספר טלפון שהוא ניחש. לכן הבדיקות
 * כאן עוברות במיוחד על מה ש**אסור** לדלוף, ולא רק על מה שאמור לעבוד.
 *
 * הרצה: npx tsx scripts/tabit-lookup-test.mts   (חינם - לא פונה למודל)
 */
import {
  normalizePhone,
  matchesName,
  matchesDate,
  phonesIn,
  identifyReservation,
  buildIdentityHint,
  type TabitReservation,
} from "../src/lib/tabit-lookup";

let pass = 0;
const fails: string[] = [];
const t = (name: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else fails.push(`${name}\n     קיבלנו:  ${JSON.stringify(got)}\n     ציפינו:  ${JSON.stringify(want)}`);
};

// ===== נרמול טלפון =====
t("מקפים", normalizePhone("052-848-7546"), "0528487546");
t("רגיל", normalizePhone("0528487546"), "0528487546");
t("קידומת בינלאומית", normalizePhone("972528487546"), "0528487546");
t("בינלאומי עם פלוס ומקפים", normalizePhone("+972-52-848-7546"), "0528487546");
t("רווחים", normalizePhone(" 052 848 7546 "), "0528487546");
t("ריק", normalizePhone(undefined), "");

// ===== שם חלקי =====
t("שם פרטי בלבד", matchesName("ההזמנה על שם שלומי", "שלומי כהן"), true);
t("שם משפחה בלבד", matchesName("על שם כהן", "שלומי כהן"), true);
t("שם מלא", matchesName("שלומי כהן", "שלומי כהן"), true);
t("שם שגוי", matchesName("על שם דני", "שלומי כהן"), false);
t("אנגלית", matchesName("its under Mike", "Mike Ross"), true);

// ===== תאריך =====
const THU = "2026-09-17"; // יום חמישי
t("נקודה", matchesDate("ההזמנה ל17.9", THU), true);
t("לוכסן", matchesDate("17/9", THU), true);
t("אפס מוביל", matchesDate("17.09", THU), true);
t("יום בשבוע", matchesDate("זה ליום חמישי", THU), true);
t("יום בשבוע שגוי", matchesDate("זה ליום שני", THU), false);
t("תאריך שגוי", matchesDate("18.9", THU), false);
t("חודש שגוי", matchesDate("17.10", THU), false);

// ===== חילוץ טלפונים =====
t("טלפון בתוך משפט", phonesIn("הטלפון שלי 052-848-7546 ותודה"), ["0528487546"]);
t("שני טלפונים", phonesIn("0501112222 או 0523334444"), ["0501112222", "0523334444"]);
t("בלי טלפון", phonesIn("על שם שלומי ליום חמישי"), []);

// ===== זיהוי =====
const RES: TabitReservation[] = [
  { id: "1", name: "שלומי כהן", phone: "0528487546", seats: 4, day: THU, time: "20:00", state: "approved" },
  { id: "2", name: "דנה לוי", phone: "0501112222", seats: 2, day: "2026-09-18", time: "19:00", state: "approved" },
  { id: "3", name: "שלומי כהן", phone: "0528487546", seats: 6, day: "2026-09-25", time: "21:00", state: "approved" },
];

t("וואטסאפ מאומת - הזמנה אחת", identifyReservation({ verifiedPhone: "972501112222", customerText: "רוצה לשנות", reservations: RES }).result?.reservation.id, "2");
const multi = identifyReservation({ verifiedPhone: "0528487546", customerText: "רוצה לשנות", reservations: RES });
t("שתי הזמנות על אותו מספר - לא נחשפות", [multi.result, multi.multiple], [undefined, true]);
t("שלושה פרטים תואמים", identifyReservation({ customerText: `על שם שלומי, 0528487546, ל17.9`, reservations: RES }).result?.reservation.id, "1");
t("טלפון נכון + שם שגוי = כלום", identifyReservation({ customerText: "על שם דני, 0528487546, ל17.9", reservations: RES }).result, undefined);
t("טלפון נכון + תאריך שגוי = כלום", identifyReservation({ customerText: "על שם שלומי, 0528487546, ל20.9", reservations: RES }).result, undefined);
t("שם ותאריך בלי טלפון = כלום", identifyReservation({ customerText: "על שם שלומי ל17.9", reservations: RES }).result, undefined);
t("דיג בלי תאריך = כלום", identifyReservation({ customerText: "0501112222 דנה", reservations: RES }).result, undefined);
t("מסנג'ר אין מספר מאומת", identifyReservation({ customerText: "רוצה לשנות הזמנה", reservations: RES }).result, undefined);

// ===== שורת ההקשר שנשלחת למודל =====
const today = "2026-09-16";
const windowLabel = () => "יותר מ-24 שעות מהמועד";
const hint = (channel: string, channelUserId: string, customerText: string, res = RES) =>
  buildIdentityHint(res, { channel, channelUserId, customerText, today, windowLabel });
const has = (s: string | undefined, sub: string) => !!s && s.includes(sub);

const hA = hint("whatsapp", "972501112222", "יש לי הזמנה ואני רוצה לשנות שעה");
t("מסלול א' - מזהה", has(hA, "דנה לוי"), true);
t("מסלול א' - כולל תווית 24 שעות", has(hA, "יותר מ-24 שעות"), true);

t("וואטסאפ ממספר לא מוכר - שום דבר", hint("whatsapp", "972544444444", "יש לי הזמנה, רוצה לשנות"), undefined);

const hB = hint("messenger", "PSID", "רוצה לשנות הזמנה. על שם שלומי, 17.9, 052-848-7546");
t("מסלול ב' - מזהה", has(hB, "שלומי כהן"), true);
t("מסלול ב' - שעה וכמות רק לפי בקשה", has(hB, "רק אם הוא שואל"), true);

// ⚠️ הליבה: טלפון נכון עם שם שגוי חייב להיראות **בדיוק** כמו חוסר פרטים,
// אחרת עצם ההודעה מסגירה שהמספר קיים ביומן.
const hWrongName = hint("messenger", "PSID", "רוצה לשנות הזמנה. על שם רועי, 17.9, 052-848-7546");
const hNoDate = hint("messenger", "PSID", "רוצה לשנות הזמנה. על שם שלומי, 052-848-7546");
t("טלפון נכון + שם שגוי לא מסגיר דבר", hWrongName, hNoDate);
t("אין התאמה - אוסר 'לא מצאתי'", has(hWrongName, 'אל תאמר "לא מצאתי"'), true);
t("אין התאמה - לא חושף שם", has(hWrongName, "שלומי"), false);

t("שלושה מספרים - עוצר ומעביר לצוות", has(hint("messenger", "PSID", "הזמנה: 0521111111 לא? אז 0522222222 אולי 0523333333"), "escalate_to_human"), true);
t("שאלה לא קשורה - שום דבר", hint("whatsapp", "972501112222", "מה שעות הפתיחה שלכם?"), undefined);

// ===== מצבים שבהם אסור להסתמך על היומן =====
t("הזמנה שבוטלה - לא קיימת", hint("whatsapp", "972544444444", "יש לי הזמנה, רוצה לשנות",
  [{ id: "9", name: "רועי", phone: "0544444444", seats: 3, day: THU, time: "18:00", state: "cancelled" }]), undefined);
t("walk-in הוא לא הזמנה", hint("whatsapp", "972544444444", "יש לי הזמנה, רוצה לשנות",
  [{ id: "9", name: "רועי", phone: "0544444444", seats: 3, day: THU, time: "18:00", state: "approved", type: "walked_in" }]), undefined);
t("הזמנה שכבר עברה - לא רלוונטית", hint("whatsapp", "972544444444", "יש לי הזמנה, רוצה לשנות",
  [{ id: "9", name: "רועי", phone: "0544444444", seats: 3, day: "2026-09-01", time: "18:00", state: "approved" }]), undefined);
t("יומן ריק (הגשר נפל) - שום דבר", hint("whatsapp", "972501112222", "יש לי הזמנה, רוצה לשנות", []), undefined);

if (fails.length) {
  console.log(`\n${fails.length} נכשלו:\n`);
  for (const f of fails) console.log(`  ❌ ${f}\n`);
}
console.log(`${pass} עברו, ${fails.length} נכשלו`);
process.exit(fails.length ? 1 : 0);
