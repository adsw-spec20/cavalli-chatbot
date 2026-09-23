/**
 * פנקס היומיים של טאביט: ההיסטוריה שטאביט לא נותן לנו.
 *
 * ⚠️ הממצא שהוליד את זה (24.9): נקודת הקצה `reservations-archived` של טאביט
 * מחזירה `400 invalid requested time range (Nh > 24h)` לכל בקשה ארוכה מיממה,
 * והטווח נמדד מ-from ועד **עכשיו**. כלומר אי-הגעות, ביטולים, הכנסות ומקורות
 * הזמנה נשלפים רק להיום ולאתמול, ואין דרך לשאול על יום ישן יותר.
 *
 * הפתרון: הסוכן ממילא מדבר עם טאביט כל חמש דקות. בכל סבב הוא מוסיף לכאן את
 * הרשומות שהתיישבו, מקובצות לפי יום ההזמנה, והשרת **ממזג** אותן לפנקס במסד
 * הנתונים שלנו. הפנקס לא נמחק כשחלון ה-24 שעות מתגלגל הלאה, ולכן מהיום שבו
 * זה עולה לאוויר ההיסטוריה מצטברת אצלנו.
 *
 * העיקרון החשוב: מיזוג, לא דריסה. חלון שמתגלגל מראה בכל פעם חתך אחר של אותו
 * יום, ודריסה הייתה מוחקת את מה שכבר ראינו.
 */

import { getRepo } from "./db";

/** רשומה מצומצמת. רק מה שצריך כדי לענות, כדי שהפנקס לא יתנפח. */
export interface LedgerRecord {
  id: string;
  /** YYYY-MM-DD של שעת ההזמנה */
  day: string;
  /** HH:MM */
  time: string;
  name: string;
  phone: string;
  seats: number;
  tables: number[];
  /** archived_reason של טאביט: "no_show" / "customer_cancelled" / "cancelled" / "אחר" / "" */
  reason: string;
  /** האם זו רשומת מזדמן (type=walked_in או הזמנה שנוצרה ברגע הישיבה) */
  walkin: boolean;
  /** מקור ההזמנה בעברית, לפילוח */
  source: string;
  /** פדיון ששולם באגורות, כשיש חשבון סגור */
  paid_agorot?: number;
  tips_agorot?: number;
}

export interface LedgerDay {
  day: string;
  /** מתי ראינו לראשונה רשומות של היום הזה (ms) */
  firstSeenAt: number;
  updatedAt: number;
  records: LedgerRecord[];
}

const dayKey = (day: string) => `tabit_ledger:${day}`;
const INDEX_KEY = "tabit_ledger_days";

/** כמה ימים לשמור. שנה ורבע מספיקה להשוואות שנה-מול-שנה ולא מנפחת את המסד. */
export const LEDGER_KEEP_DAYS = 400;

/**
 * מיזוג רשומות חדשות לתוך יום קיים. רשומה קיימת **מתעדכנת** (הסטטוס שלה
 * משתנה במהלך הערב: הזמנה הופכת ל-no_show רק בסוף), רשומה חדשה נוספת, ושום
 * דבר לא נמחק.
 */
export function mergeLedgerDay(existing: LedgerDay | null, day: string, incoming: LedgerRecord[], now: number): LedgerDay {
  const byId = new Map<string, LedgerRecord>();
  for (const r of existing?.records ?? []) byId.set(r.id, r);
  for (const r of incoming) byId.set(r.id, r);
  return {
    day,
    firstSeenAt: existing?.firstSeenAt ?? now,
    updatedAt: now,
    records: [...byId.values()].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0)),
  };
}

/**
 * האם הפנקס אמין ליום הזה.
 *
 * הוא אמין רק אם התחלנו לאסוף **לפני** שהשירות של אותו יום התחיל. יום שהתחלנו
 * לתעד באמצעו ייראה שלם ויהיה חסר, וזו בדיוק הטעות שהפנקס נועד למנוע.
 * 06:00 הוא לפני כל שעת פתיחה אפשרית.
 */
export function ledgerIsComplete(entry: LedgerDay): boolean {
  const serviceStart = new Date(`${entry.day}T06:00:00+03:00`).getTime();
  return entry.firstSeenAt <= serviceStart;
}

// ===== חישוב התוצאה של יום, בקוד =====

const REAL_CANCEL = new Set(["customer_cancelled", "cancelled", "אחר"]);

export interface DayOutcome {
  day: string;
  booked_total: number;
  no_show: number;
  cancelled: number;
  arrived: number;
  walk_ins: number;
  walk_in_no_show: number;
  no_show_rate_pct: number;
  covers: { no_show: number; cancelled: number; arrived: number; walk_ins: number };
  no_show_list: LedgerRecord[];
  cancelled_list: LedgerRecord[];
}

/** אותו חישוב בדיוק שהסוכן עושה על הנתונים החיים, כאן מעל הפנקס. */
export function computeDayOutcome(records: LedgerRecord[], day: string): DayOutcome {
  const onDay = records.filter((r) => r.day === day && r.reason !== "idle-temp-reservation");
  const booked = onDay.filter((r) => !r.walkin);
  const walkIns = onDay.filter((r) => r.walkin);
  const noShow = booked.filter((r) => r.reason === "no_show");
  const cancelled = booked.filter((r) => REAL_CANCEL.has(r.reason));
  const arrived = booked.filter((r) => r.reason !== "no_show" && !REAL_CANCEL.has(r.reason));
  const sum = (a: LedgerRecord[]) => a.reduce((s, r) => s + (r.seats || 0), 0);
  return {
    day,
    booked_total: booked.length,
    no_show: noShow.length,
    cancelled: cancelled.length,
    arrived: arrived.length,
    walk_ins: walkIns.length,
    walk_in_no_show: walkIns.filter((r) => r.reason === "no_show").length,
    no_show_rate_pct: booked.length ? Math.round((noShow.length / booked.length) * 1000) / 10 : 0,
    covers: { no_show: sum(noShow), cancelled: sum(cancelled), arrived: sum(arrived), walk_ins: sum(walkIns) },
    no_show_list: noShow,
    cancelled_list: cancelled,
  };
}

export interface RevenueOutcome {
  orders: number;
  covers: number;
  revenue_ils: number;
  tips_ils: number;
  avg_check_ils: number;
  per_person_ils: number;
  tip_pct: number;
}

export function computeRevenue(records: LedgerRecord[], day: string): RevenueOutcome {
  const paid = records.filter((r) => r.day === day && (r.paid_agorot ?? 0) > 0);
  const revenue = paid.reduce((s, r) => s + (r.paid_agorot ?? 0), 0);
  const tips = paid.reduce((s, r) => s + (r.tips_agorot ?? 0), 0);
  const covers = paid.reduce((s, r) => s + (r.seats || 0), 0);
  const ils = (n: number) => Math.round(n) / 100;
  return {
    orders: paid.length,
    covers,
    revenue_ils: ils(revenue),
    tips_ils: ils(tips),
    avg_check_ils: paid.length ? ils(revenue / paid.length) : 0,
    per_person_ils: covers ? ils(revenue / covers) : 0,
    tip_pct: revenue ? Math.round((tips / revenue) * 1000) / 10 : 0,
  };
}

export function computeSources(records: LedgerRecord[], day: string) {
  const onDay = records.filter((r) => r.day === day && r.reason !== "idle-temp-reservation");
  const counts: Record<string, number> = {};
  for (const r of onDay) counts[r.source] = (counts[r.source] || 0) + 1;
  const total = onDay.length;
  return {
    total,
    breakdown: Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([source, count]) => ({ source, count, pct: total ? Math.round((count / total) * 1000) / 10 : 0 })),
  };
}

// ===== אחסון =====

export async function readLedgerDay(day: string): Promise<LedgerDay | null> {
  const raw = await getRepo().getSetting(dayKey(day));
  if (!raw) return null;
  try { return JSON.parse(raw) as LedgerDay; } catch { return null; }
}

export async function listLedgerDays(): Promise<string[]> {
  const raw = await getRepo().getSetting(INDEX_KEY);
  if (!raw) return [];
  try { return (JSON.parse(raw) as string[]).sort(); } catch { return []; }
}

/**
 * קליטת מנה מהסוכן: ממזג לכל יום, מעדכן את האינדקס וגוזם ימים ישנים.
 * מחזיר אילו ימים נגעו, לצורך לוג.
 */
export async function ingestLedger(
  batch: Record<string, LedgerRecord[]>,
  now = Date.now()
): Promise<{ days: string[]; pruned: string[] }> {
  const repo = getRepo();
  const days = Object.keys(batch).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  for (const day of days) {
    const merged = mergeLedgerDay(await readLedgerDay(day), day, batch[day], now);
    await repo.setSetting(dayKey(day), JSON.stringify(merged));
  }

  const index = new Set(await listLedgerDays());
  for (const d of days) index.add(d);
  const cutoff = new Date(now - LEDGER_KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  const pruned = [...index].filter((d) => d < cutoff);
  for (const d of pruned) {
    index.delete(d);
    await repo.setSetting(dayKey(d), "");
  }
  await repo.setSetting(INDEX_KEY, JSON.stringify([...index].sort()));
  return { days, pruned };
}
