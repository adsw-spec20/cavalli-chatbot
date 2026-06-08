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

export function isOpenNow(config: BusinessConfig): boolean {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(new Date());
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);

  const heDay = EN_TO_HE_DAY[weekday];
  const entry = config.hours.find((h) => h.day === heDay);
  if (!entry || !entry.hours) return false;

  const m = entry.hours.match(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/);
  if (!m) return false;

  const start = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  let end = parseInt(m[3], 10) * 60 + parseInt(m[4], 10);
  if (end === 0) end = 24 * 60; // 24:00
  const now = hour * 60 + minute;
  return now >= start && now < end;
}
