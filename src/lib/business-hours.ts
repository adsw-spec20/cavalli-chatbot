/**
 * חישוב האם בית הקפה פתוח כרגע, לפי שעות הפעילות בקונפיג ושעון ישראל.
 * משמש למשל כדי לנסח נכון הודעת העברה לאדם ("יחזרו אליך בהקדם" מול
 * "יחזרו אליך בשעות הפעילות").
 */

import type { BusinessConfig } from "./business-config";

const EN_TO_HE_DAY: Record<string, string> = {
  Sunday: "ראשון",
  Monday: "שני",
  Tuesday: "שלישי",
  Wednesday: "רביעי",
  Thursday: "חמישי",
  Friday: "שישי",
  Saturday: "שבת",
};

const HE_DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

/**
 * תווית תאריך אנושית בעברית יחסית להיום (היום / מחר / מחרתיים / יום בשבוע).
 * מחושבת בקוד כדי שהבוט לא יצטרך לחשב תאריכים (מודלים גרועים בזה).
 * דוגמה: "מחר (חמישי, 11/06)".
 */
export function relativeDateLabel(dateISO: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO);
  if (!m) return dateISO;
  const [ty, tm, td] = israelDateISO().split("-").map(Number);
  const ey = Number(m[1]);
  const em = Number(m[2]);
  const ed = Number(m[3]);
  const todayUTC = Date.UTC(ty, tm - 1, td);
  const evUTC = Date.UTC(ey, em - 1, ed);
  const diff = Math.round((evUTC - todayUTC) / 86400000);
  const weekday = HE_DAYS[new Date(evUTC).getUTCDay()];
  const dm = `${m[3]}/${m[2]}`;
  // כוללים את מספר הימים ("בעוד 8 ימים") כדי שהבוט לא יצטרך לחשב מתי זה, ולא יתבלבל
  // כששואלים "מה יש עוד X ימים". התווית מחושבת בקוד; המודל רק משתמש בה כמו שהיא.
  let rel: string;
  if (diff < 0) rel = "עבר";
  else if (diff === 0) rel = "היום";
  else if (diff === 1) rel = "מחר";
  else if (diff === 2) rel = "מחרתיים";
  else rel = `בעוד ${diff} ימים`;
  return `${rel} (יום ${weekday}, ${dm})`;
}

/** התאריך של היום בישראל בפורמט YYYY-MM-DD. */
export function israelDateISO(): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return p; // en-CA נותן YYYY-MM-DD
}

/** השעות התקפות להיום: דריסה נקודתית אם קיימת, אחרת השעות הקבועות. */
export function effectiveHoursToday(config: BusinessConfig): string | null {
  const today = israelDateISO();
  const override = config.hoursOverrides?.find((o) => o.date === today);
  if (override) return override.hours;
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", weekday: "long" });
  const weekday = fmt.format(new Date());
  const heDay = EN_TO_HE_DAY[weekday];
  return config.hours.find((h) => h.day === heDay)?.hours ?? null;
}

export function isOpenNow(config: BusinessConfig): boolean {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(new Date());
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);

  const hours = effectiveHoursToday(config);
  if (!hours) return false;

  const m = hours.match(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/);
  if (!m) return false;

  const start = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  let end = parseInt(m[3], 10) * 60 + parseInt(m[4], 10);
  if (end === 0) end = 24 * 60; // 24:00
  const now = hour * 60 + minute;
  return now >= start && now < end;
}

// ----- חלון פעולת שער החניה: שעה לפני הפתיחה עד שעה אחרי הסגירה -----
// (דרישת בעל העסק: אם פתוחים 08:00-00:00, השער עובד 07:00-01:00.)
export const GATE_WINDOW_BUFFER_MIN = 60;

/** מפרק מחרוזת שעות "HH:MM-HH:MM" ל-{start,end} בדקות מחצות. 00:00 בסוף = 24:00.
 *  אם הסגירה חוצה חצות (סגירה קטנה מהפתיחה) - מוסיפים יום לסגירה. */
function parseHoursRange(hours: string | null): { start: number; end: number } | null {
  if (!hours) return null;
  const m = hours.match(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const start = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  let end = parseInt(m[3], 10) * 60 + parseInt(m[4], 10);
  if (end === 0) end = 24 * 60; // 00:00 = חצות = סוף היום
  if (end <= start) end += 24 * 60; // חוצה חצות (למשל 20:00-02:00)
  return { start, end };
}

/** השעות התקפות לתאריך נתון (דריסה נקודתית אם קיימת, אחרת השעות הקבועות של אותו יום). */
function hoursForDate(config: BusinessConfig, dateISO: string): string | null {
  const override = config.hoursOverrides?.find((o) => o.date === dateISO);
  if (override) return override.hours;
  const [y, mo, d] = dateISO.split("-").map(Number);
  const weekday = HE_DAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  return config.hours.find((h) => h.day === weekday)?.hours ?? null;
}

/** לוגיקה טהורה (בלי שעון) לבדיקת החלון - כדי שאפשר יהיה לבדוק אותה עם זמנים קבועים.
 *  nowMin = דקות מחצות היום; מקבלת את שעות היום ושעות אתמול (לטיפול בחלון שחוצה חצות). */
export function gateWindowContains(
  nowMin: number,
  todayHours: string | null,
  yesterdayHours: string | null,
  bufferMin: number = GATE_WINDOW_BUFFER_MIN
): boolean {
  const t = parseHoursRange(todayHours);
  if (t && nowMin >= t.start - bufferMin && nowMin <= t.end + bufferMin) return true;
  // חלון של אתמול שנמשך אחרי חצות אל תוך היום (למשל סגירה 00:00 + שעה = 01:00 היום)
  const y = parseHoursRange(yesterdayHours);
  if (y) {
    const spillEnd = y.end + bufferMin - 24 * 60;
    if (spillEnd > 0 && nowMin <= spillEnd) return true;
  }
  return false;
}

/** האם עכשיו (שעון ישראל) בתוך חלון פעולת השער: שעה לפני הפתיחה עד שעה אחרי הסגירה. */
export function isWithinGateWindow(
  config: BusinessConfig,
  bufferMin: number = GATE_WINDOW_BUFFER_MIN
): boolean {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(new Date());
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  const nowMin = hour * 60 + minute;

  const todayISO = israelDateISO();
  const [y, mo, d] = todayISO.split("-").map(Number);
  const yDate = new Date(Date.UTC(y, mo - 1, d));
  yDate.setUTCDate(yDate.getUTCDate() - 1);
  const yesterdayISO = yDate.toISOString().slice(0, 10);

  return gateWindowContains(
    nowMin,
    hoursForDate(config, todayISO),
    hoursForDate(config, yesterdayISO),
    bufferMin
  );
}
