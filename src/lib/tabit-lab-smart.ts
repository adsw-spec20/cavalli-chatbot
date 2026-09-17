/**
 * שכבת האמינות של מעבדת טאביט - לוגיקה דטרמיניסטית בצד השרת.
 *
 * נולדה מתקלות אמיתיות שהצוות דיווח (15.9): הבוט קרא ל-21.9 "יום ראשון"
 * (זה יום שני), אישר זמינות בשעה שהמסעדה סגורה, פספס הזמנות על שולחן,
 * ולא מצא הזמנה לפי שם. העיקרון: כל מה שמודל שפה גרוע בו - תאריכים,
 * שעות פתיחה, חיפוש והצלבה - מחושב כאן בקוד, והמודל רק מציג.
 */

import type { BusinessConfig } from "./business-config";
import { lastSeatingForDate } from "./business-hours";
import type { TabitDeposit } from "./tabit-format";
import { getRepo } from "./db";

export const HE_DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

/** התאריך בישראל בפורמט YYYY-MM-DD */
export function todayIL(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** יום בשבוע בעברית לתאריך ISO - מחושב בקוד, לא על ידי המודל */
export function weekdayHe(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return HE_DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? "";
}

/** "today"/"tomorrow"/"yesterday"/ISO -> ISO (מקבילה לצד-שרת של resolveDay בסוכן) */
export function resolveDayISO(day: unknown): string {
  const s = String(day ?? "today").trim().toLowerCase();
  if (s === "today" || s === "היום" || s === "") return todayIL();
  if (s === "tomorrow" || s === "מחר") return addDaysISO(todayIL(), 1);
  if (s === "yesterday" || s === "אתמול") return addDaysISO(todayIL(), -1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return todayIL();
}

/**
 * בלוק לוח-שנה לפרומפט: 14 הימים הקרובים עם היום בשבוע של כל אחד.
 * המקור האחד והיחיד לימי שבוע - המודל מנוע מלחשב לבד.
 */
export function calendarBlock(): string {
  const t = todayIL();
  const lines: string[] = [];
  for (let i = 0; i < 14; i++) {
    const iso = addDaysISO(t, i);
    const tag = i === 0 ? " (היום)" : i === 1 ? " (מחר)" : "";
    lines.push(`${iso} = יום ${weekdayHe(iso)}${tag}`);
  }
  return `לוח התאריכים (המקור היחיד לימי שבוע - לעולם אל תחשב יום בשבוע בעצמך):\n${lines.join("\n")}`;
}

/** "HH:MM-HH:MM" -> דקות; 00:00 בסוף = 24:00; סגירה קטנה מפתיחה = חוצה חצות */
function parseHoursRange(hours: string | null): { start: number; end: number } | null {
  if (!hours) return null;
  const m = hours.match(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const start = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  let end = parseInt(m[3], 10) * 60 + parseInt(m[4], 10);
  if (end === 0) end = 24 * 60;
  if (end <= start) end += 24 * 60;
  return { start, end };
}

/** השעות התקפות לתאריך (דריסה נקודתית גוברת על הקבוע) */
export function hoursForDateISO(cfg: BusinessConfig, iso: string): string | null {
  const override = cfg.hoursOverrides?.find((o) => o.date === iso);
  if (override) return override.hours;
  return cfg.hours.find((h) => h.day === weekdayHe(iso))?.hours ?? null;
}

/**
 * האם המסעדה פתוחה בתאריך+שעה נתונים. השער הדטרמיניסטי של בדיקת הזמינות:
 * שעה מחוץ לשעות הפתיחה = סגור, בלי קשר לכמה שולחנות "פנויים" בטאביט.
 */
export function checkOpenAt(cfg: BusinessConfig, dateISO: string, timeHHMM: string): {
  open: boolean;
  weekday_he: string;
  hours_that_day: string | null;
} {
  const hours = hoursForDateISO(cfg, dateISO);
  const out = { weekday_he: weekdayHe(dateISO), hours_that_day: hours };
  const range = parseHoursRange(hours);
  if (!range) return { open: false, ...out };
  const tm = timeHHMM.match(/^(\d{1,2}):(\d{2})$/);
  if (!tm) return { open: false, ...out };
  const min = parseInt(tm[1], 10) * 60 + parseInt(tm[2], 10);
  // שעת ההושבה האחרונה מגיעה מהמידע העסקי (ניתנת לעריכה בפאנל). קודם היא
  // הייתה מקודדת כאן כ"שעה לפני הסגירה" - מספר שבמקרה יצא נכון לערבי שני-חמישי
  // (סגירה בחצות -> 23:00) אבל היה ניחוש ביום שישי (סגירה 15:00 -> 14:00).
  // כשלא הוגדרה שעה ליום מסוים נשארים על אותו מרווח שעה, כדי לא לשנות התנהגות.
  const configured = lastSeatingForDate(cfg, dateISO);
  const lastSeatMin = configured
    ? parseInt(configured.slice(0, 2), 10) * 60 + parseInt(configured.slice(3, 5), 10)
    : range.end - 60;
  return { open: min >= range.start && min <= lastSeatMin, ...out };
}

/** בלוק שעות הפתיחה לפרומפט */
export function hoursBlock(cfg: BusinessConfig): string {
  const lines = cfg.hours.map(
    (h) => `יום ${h.day}: ${h.hours ?? "סגור"}${h.hours && h.lastSeating ? ` (הושבה אחרונה ${h.lastSeating})` : ""}`
  );
  const t = todayIL();
  const overrides = (cfg.hoursOverrides ?? [])
    .filter((o) => o.date >= t)
    .map((o) => `${o.date} (יום ${weekdayHe(o.date)}): ${o.hours ?? "סגור"}${o.note ? ` - ${o.note}` : ""}`);
  return [
    "שעות הפתיחה של המסעדה (זמינות/ישיבה אפשרית רק בתוכן; 00:00 = חצות):",
    ...lines,
    ...(overrides.length ? ["דריסות נקודתיות:", ...overrides] : []),
  ].join("\n");
}

// ===== חיפוש דטרמיניסטי מעל נתוני ההזמנות =====

/** שורת הזמנה כפי שהיא ב-snapshot (normalizeForSnapshot בסוכן) וב-read_day */
export interface LabResRow {
  id: string;
  name: string;
  phone: string;
  seats: number;
  day: string;
  time: string;
  tables: number[];
  /** ⚠️ שלושה מצבים ולא שניים - ראה missingDepositFooter ב-tabit-format.ts */
  deposit?: TabitDeposit;
  state?: string;
  notes?: string;
}

/** נרמול שם לחיפוש: אותיות קטנות, בלי ניקוד/פיסוק, רווחים מכווצים */
export function normName(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[֑-ׇ]/g, "") // ניקוד
    .replace(/["'`׳״.,\-_()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** ספרות בלבד, בלי קידומת בינלאומית - להשוואת טלפונים סלחנית */
export function normPhone(s: unknown): string {
  const d = String(s ?? "").replace(/\D/g, "");
  return d.startsWith("972") ? "0" + d.slice(3) : d;
}

export function nameMatches(rowName: string, query: string): boolean {
  const a = normName(rowName);
  const q = normName(query);
  if (!a || !q) return false;
  if (a.includes(q)) return true;
  // התאמה לפי מילים: כל מילות החיפוש מופיעות כתחיליות של מילים בשם
  const words = a.split(" ");
  return q.split(" ").every((qw) => words.some((w) => w.startsWith(qw)));
}

export function phoneMatches(rowPhone: string, query: string): boolean {
  const a = normPhone(rowPhone);
  const q = normPhone(query);
  if (!a || !q || q.length < 4) return false;
  return a.includes(q) || q.includes(a);
}

export interface SnapshotData {
  generatedAt?: number;
  reservations?: LabResRow[];
  floor?: { tables?: { number: number; area?: string; current?: { name?: string; seats?: number; seated_min?: number; remaining_min?: number; flag?: string } | null; next?: unknown }[] };
}

/** קורא את ה-snapshot העדכני מהשרת (הסוכן דוחף כל ~5 דק') */
export async function loadSnapshot(): Promise<SnapshotData | null> {
  const raw = await getRepo().getSetting("tabit_snapshot");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SnapshotData;
  } catch {
    return null;
  }
}

export function snapshotAgeMinutes(s: SnapshotData | null): number | null {
  if (!s?.generatedAt) return null;
  return Math.max(0, Math.round((Date.now() - s.generatedAt) / 60000));
}

/** סינון הזמנות לפי שם/טלפון/שולחנות/יום - הצלבה בקוד, לא במודל */
export function filterRows(
  rows: LabResRow[],
  q: { name?: string; phone?: string; tables?: number[]; day?: string }
): LabResRow[] {
  return rows.filter((r) => {
    if (r.state === "cancelled") return false;
    if (q.day && r.day !== q.day) return false;
    if (q.tables?.length && !r.tables?.some((t) => q.tables!.includes(t))) return false;
    if (q.name && !nameMatches(r.name, q.name)) return false;
    if (q.phone && !phoneMatches(r.phone, q.phone)) return false;
    return true;
  });
}

/** שורה תמציתית להחזרה למודל */
export function rowOut(r: LabResRow) {
  return {
    id: r.id,
    day: r.day,
    weekday_he: weekdayHe(r.day),
    time: r.time,
    name: r.name,
    phone: r.phone,
    seats: r.seats,
    tables: r.tables,
    deposit: r.deposit,
    ...(r.notes ? { notes: r.notes } : {}),
  };
}
