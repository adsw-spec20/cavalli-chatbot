/**
 * הפורמט האחיד להצגת רשימת הזמנות מטאביט.
 *
 * למה זה עבר לכאן (17.9): הפורמט הזה נכתב בתוך רכיב ה-React של לשונית טאביט,
 * כלומר בצד הלקוח בלבד. צ'אט המעבדה רץ בשרת, לא הייתה לו שום גישה אליו, ולכן
 * הוא המציא פורמט משלו בכל תשובה - ובדרך גם השמיט שורות. שני הצדדים קוראים
 * עכשיו לאותו קוד, ולכן הפורמט זהה **בהגדרה** ולא במקרה.
 *
 * העיקרון שמאחורי זה: הרשימה נבנית **בקוד** ונמסרת למודל מוכנה להדבקה. מודל
 * שמקבל נתונים גולמיים ומסכם אותם בעצמו משמיט שורות כשהרשימה ארוכה - זה מה
 * שקרה בפועל כששאלו "כמה שולחנות יש מהשעה 17:00".
 */

const WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

export const EVENING_MIN = 18 * 60;

export type TabitDeposit = "secured" | "missing" | "none";

/** שורת הזמנה כפי שהיא ב-snapshot של הגשר */
export interface TabitResRow {
  id?: string;
  name?: string;
  phone?: string;
  seats?: number;
  day?: string;
  time?: string;
  tables?: number[];
  deposit?: TabitDeposit;
  notes?: string;
  fromISO?: string | null;
}

/** מספר ישראלי נייד -> 05X-XXX-XXXX. אחרת מחזיר כמו שהוא. */
export function fmtPhoneIL(p?: string): string {
  const d = (p || "").replace(/\D/g, "").replace(/^972/, "0");
  return /^0\d{9}$/.test(d) ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : (p || "").trim();
}

/**
 * "HH:MM" -> דקות מחצות. שעה חסרה או לא תקינה מחזירה -1.
 *
 * ⚠️ Number("") הוא 0 ולא NaN, ולכן הגרסה הקודמת החזירה 0 לשעה ריקה - כלומר
 * הזמנה בלי שעה נראתה כאילו היא ב-00:00, קפצה לראש הרשימה ונחשבה "בוקר".
 */
export function toMinutes(hhmm?: string): number {
  const s = (hhmm || "").trim();
  if (!/^\d{1,2}:\d{2}$/.test(s)) return -1;
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

function israelTodayISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

/** "להיום"/"למחר"/"ליום שלישי" + תאריך קצר, לכותרות ההעתקה */
export function waDateParts(iso: string, todayISO = israelTodayISO()): { ref: string; date: string } {
  const [y, m, d] = iso.split("-").map(Number);
  const date = `${d}.${m}.${String(y).slice(2)}`;
  if (iso === todayISO) return { ref: "להיום", date };
  if (iso === addDays(todayISO, 1)) return { ref: "למחר", date };
  return { ref: `ליום ${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}`, date };
}

export function waDepositMark(d?: TabitDeposit): string {
  return d === "secured" ? "✅" : d === "missing" ? "❌ חסר פיקדון" : "ללא פיקדון";
}

/** בלוק הזמנה אחת: שורת כותרת מודגשת + שורת פרטים (+ הערה אם יש) */
export function waResBlock(r: TabitResRow): string {
  const tables = r.tables?.length ? `ש׳ ${r.tables.join(",")}` : "ללא שולחן";
  const lines = [
    `*${r.time} · ${r.name || "(ללא שם)"} · ${r.seats ?? 0} סועדים*`,
    `${tables} | ${fmtPhoneIL(r.phone) || "-"} | ${waDepositMark(r.deposit)}`,
  ];
  if (r.notes) lines.push(`💬 ${r.notes}`);
  return lines.join("\n");
}

/** רשימת הזמנות מקובצת 🌅 בוקר / 🌆 ערב, ממוינת לפי שעה */
export function waGrouped(list: TabitResRow[]): string {
  const sorted = [...list].sort((a, b) => toMinutes(a.time) - toMinutes(b.time));
  const morning = sorted.filter((r) => toMinutes(r.time) < EVENING_MIN);
  const evening = sorted.filter((r) => toMinutes(r.time) >= EVENING_MIN);
  const parts: string[] = [];
  if (morning.length) parts.push(`🌅 *בוקר*\n\n${morning.map(waResBlock).join("\n\n")}`);
  if (evening.length) parts.push(`🌆 *ערב*\n\n${evening.map(waResBlock).join("\n\n")}`);
  return parts.join("\n\n");
}

export interface RenderListOptions {
  /** "כל ההזמנות" / "שולחנות גדולים" - בלי ה"להיום", שמתווסף אוטומטית */
  title: string;
  dayISO: string;
  list: TabitResRow[];
  /** המילה בשורת הסיכום. ברירת מחדל: "הזמנות". */
  summaryNoun?: string;
  /** תוספת לכותרת כשהרשימה מסוננת, למשל "מ-17:00 ואילך" */
  scopeNote?: string;
  /** שורת זנב (למשל אזהרת פיקדונות חסרים) */
  footer?: string;
  /** סה"כ סועדים. אם לא נמסר - מחושב מהרשימה. */
  covers?: number;
  todayISO?: string;
}

/**
 * הרשימה המלאה בפורמט וואטסאפ. זה בדיוק מה שכפתור ההעתקה בלשונית "יום" מפיק,
 * וזה בדיוק מה שצ'אט המעבדה מחזיר - אותה פונקציה.
 */
export function renderReservationList(o: RenderListOptions): string {
  const { ref, date } = waDateParts(o.dayISO, o.todayISO);
  const n = o.list.length;
  const covers = o.covers ?? o.list.reduce((s, r) => s + (r.seats ?? 0), 0);
  const noun = o.summaryNoun ?? "הזמנות";
  const head = `*${o.title} ${ref}${o.scopeNote ? ` ${o.scopeNote}` : ""}* (${date})`;
  if (!n) {
    return [head, "אין הזמנות בטווח הזה."].join("\n");
  }
  return [
    head,
    `${n} הזמנות · ${covers} סועדים`,
    "",
    waGrouped(o.list),
    "",
    `*סה״כ:* ${n} ${noun} · ${covers} סועדים`,
    ...(o.footer ? [o.footer] : []),
  ].join("\n");
}

/**
 * סינון לפי טווח שעות, בקוד.
 *
 * "מהשעה 17:00" נקרא על ידי המודל כ"בשעה 17:00", והוא החזיר הזמנה אחת במקום
 * שלושים וארבע. הסינון הזה הוא מה שמוציא את ההחלטה מידיו.
 */
export function filterByTimeRange(list: TabitResRow[], from?: string, to?: string): TabitResRow[] {
  const f = from ? toMinutes(from) : -1;
  const t = to ? toMinutes(to) : Number.MAX_SAFE_INTEGER;
  if (f < 0 && t === Number.MAX_SAFE_INTEGER) return list;
  return list.filter((r) => {
    const m = toMinutes(r.time);
    // הזמנה בלי שעה תקינה **נשארת**: אי אפשר לדעת אם היא בטווח, והשמטה שקטה
    // היא בדיוק הכשל שהסינון הזה נועד למנוע. עדיף שורה עודפת וגלויה.
    if (m < 0) return true;
    return m >= f && m <= t;
  });
}

/** "מ-17:00 ואילך" / "בין 17:00 ל-20:00" / "" - לתיאור הטווח בכותרת */
export function scopeNoteFor(from?: string, to?: string): string {
  if (from && to) return `בין ${from} ל-${to}`;
  if (from) return `מ-${from} ואילך`;
  if (to) return `עד ${to}`;
  return "";
}
