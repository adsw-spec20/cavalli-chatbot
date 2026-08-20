/**
 * מעקב שימוש ועלות אמיתית.
 *
 * כל קריאה למודל מדווחת לכאן עם מספר הטוקנים בפועל, ואנחנו מחשבים עלות לפי
 * מחירון Anthropic ושומרים סיכום יומי. כך אפשר לראות בפאנל כמה באמת עולה
 * הבוט - במקום להעריך - ולהגדיר תקרה יומית כרשת ביטחון.
 *
 * אחסון: מפתח אחד לחודש בטבלת ההגדרות ("usage_YYYY-MM"), שמכיל אובייקט
 * לפי יום. ככה קריאה/כתיבה אחת מכסות גם את התקרה וגם את המד.
 */

import { getRepo } from "./db";
import { israelDateISO } from "./business-hours";

/** מחירון לפי מיליון טוקנים (דולר). קריאת מטמון = 0.1x קלט, כתיבה = 1.25x. */
const PRICING: Record<
  string,
  { input: number; output: number; cacheRead: number; cacheWrite: number }
> = {
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};
const DEFAULT_PRICING = PRICING["claude-sonnet-4-6"];

/** תמלול קולי (OpenAI Whisper) - דולר לדקת אודיו. */
const WHISPER_PER_MINUTE = 0.006;

export interface DayUsage {
  /** מספר תשובות בוט (משמש גם לתקרה היומית) */
  replies: number;
  /** תשובות חינמיות (תבניות/ידע/מחירים - בלי מודל). מודד את החיסכון. */
  freeReplies?: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  /** שניות אודיו שתומללו */
  audioSeconds: number;
  /** עלות מצטברת בדולר */
  cost: number;
}

const emptyDay = (): DayUsage => ({
  replies: 0,
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  audioSeconds: 0,
  cost: 0,
});

type Month = Record<string, DayUsage>;

const monthKeyOf = (dateISO: string) => `usage_${dateISO.slice(0, 7)}`;

async function loadMonth(dateISO: string): Promise<Month> {
  try {
    const raw = await getRepo().getSetting(monthKeyOf(dateISO));
    return raw ? (JSON.parse(raw) as Month) : {};
  } catch {
    return {};
  }
}

async function saveMonth(dateISO: string, month: Month): Promise<void> {
  await getRepo().setSetting(monthKeyOf(dateISO), JSON.stringify(month));
}

/** השימוש של היום (לבדיקת התקרה היומית ולתצוגה). */
export async function getTodayUsage(): Promise<DayUsage> {
  const today = israelDateISO();
  const month = await loadMonth(today);
  return month[today] ?? emptyDay();
}

/** עדכון אטומי-מספיק של רשומת היום (קריאה-שינוי-כתיבה). */
async function updateToday(mutate: (d: DayUsage) => void): Promise<void> {
  const today = israelDateISO();
  const month = await loadMonth(today);
  const day = month[today] ?? emptyDay();
  mutate(day);
  day.cost = Math.round(day.cost * 1e6) / 1e6;
  month[today] = day;
  await saveMonth(today, month);
}

export interface LlmUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** מדווח על קריאה למודל: מוסיף טוקנים ועלות ליום הנוכחי. */
export async function recordLlmUsage(
  model: string,
  usage: LlmUsage,
  countsAsReply = true
): Promise<void> {
  const p = PRICING[model] ?? DEFAULT_PRICING;
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cost =
    (input * p.input +
      output * p.output +
      cacheRead * p.cacheRead +
      cacheWrite * p.cacheWrite) /
    1_000_000;

  try {
    await updateToday((d) => {
      if (countsAsReply) d.replies += 1;
      d.inputTokens += input;
      d.outputTokens += output;
      d.cacheReadTokens += cacheRead;
      d.cacheWriteTokens += cacheWrite;
      d.cost += cost;
    });
  } catch (err) {
    console.error("[usage] רישום שימוש נכשל:", err);
  }
}

/** מדווח על תשובה חינמית (תבנית/ידע/מחיר - בלי מודל). למד החיסכון בפאנל. */
export async function recordFreeReply(): Promise<void> {
  try {
    await updateToday((d) => {
      d.freeReplies = (d.freeReplies ?? 0) + 1;
    });
  } catch {
    /* לא קריטי */
  }
}

/** מדווח על תמלול קולי (לפי אורך האודיו בשניות). */
export async function recordTranscription(seconds: number): Promise<void> {
  if (!seconds || seconds <= 0) return;
  try {
    await updateToday((d) => {
      d.audioSeconds += seconds;
      d.cost += (seconds / 60) * WHISPER_PER_MINUTE;
    });
  } catch {
    /* לא קריטי */
  }
}

export interface CostSummary {
  today: DayUsage;
  monthCost: number;
  monthReplies: number;
  /** תחזית לסוף החודש לפי הקצב עד כה */
  projectedMonthCost: number;
  /** עלות ממוצעת לתשובה החודש */
  avgCostPerReply: number;
  /** פירוט יומי (לגרף ולבורר הטווחים) */
  days: { date: string; cost: number; replies: number; free: number }[];
}

/** תאריך ISO של היום הראשון בחודש, n חודשים אחורה */
function monthStartBack(dateISO: string, n: number): string {
  const y = Number(dateISO.slice(0, 4));
  const m = Number(dateISO.slice(5, 7));
  return new Date(Date.UTC(y, m - 1 - n, 1)).toISOString().slice(0, 10);
}

/** סיכום עלויות לפאנל: החודש הנוכחי + פירוט יומי של ~3 חודשים (לבורר הטווחים). */
export async function getCostSummary(): Promise<CostSummary> {
  const today = israelDateISO();
  // שלושה חודשים של פירוט יומי - מאפשר "30 הימים האחרונים" וטווח מותאם חוצה-חודשים
  const [m2, m1, month] = await Promise.all([
    loadMonth(monthStartBack(today, 2)),
    loadMonth(monthStartBack(today, 1)),
    loadMonth(today),
  ]);
  const days = [...Object.entries(m2), ...Object.entries(m1), ...Object.entries(month)]
    .map(([date, d]) => ({ date, cost: d.cost, replies: d.replies, free: d.freeReplies ?? 0 }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const thisMonth = today.slice(0, 7);
  const monthDays = days.filter((d) => d.date.startsWith(thisMonth));
  const monthCost = monthDays.reduce((s, d) => s + d.cost, 0);
  const monthReplies = monthDays.reduce((s, d) => s + d.replies, 0);

  const dayOfMonth = Number(today.slice(8, 10));
  const daysInMonth = new Date(
    Number(today.slice(0, 4)),
    Number(today.slice(5, 7)),
    0
  ).getDate();
  const projectedMonthCost = dayOfMonth > 0 ? (monthCost / dayOfMonth) * daysInMonth : 0;

  return {
    today: month[today] ?? emptyDay(),
    monthCost,
    monthReplies,
    projectedMonthCost,
    avgCostPerReply: monthReplies ? monthCost / monthReplies : 0,
    days,
  };
}
