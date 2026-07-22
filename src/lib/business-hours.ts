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
