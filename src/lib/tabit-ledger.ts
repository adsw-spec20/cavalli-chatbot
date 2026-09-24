/**
 * פנקס היומיים של טאביט: רשת ביטחון היסטורית, לא המקור הראשי.
 *
 * ⚠️ הפנקס נבנה ב-24.9 מתוך מסקנה שגויה. מדדנו שכל בקשת ארכיון ארוכה מיממה
 * חוזרת `400 invalid requested time range (Nh > 24h)` והסקנו שאין גישה
 * להיסטוריה. מה שבאמת קורה: המגבלה היא על **גודל החלון**, והפרמטר שסוגר אותו
 * נקרא `until` ולא `to` - שליחת `to` נבלעת בשקט והשרת מודד מ-from ועד עכשיו.
 * עם `until` אפשר לשלוף כל יום, וזה מה שהממשק של טאביט עושה.
 *
 * לכן **קריאה מהפנקס כבויה** (ראה LEDGER_READS ב-tabit-lab.ts): שני מסלולי
 * חישוב לאותה שאלה הם בדיוק הדרך שבה שני מספרים שונים מגיעים לאותו צוות.
 * האיסוף ממשיך, כי הוא זול ונותן עוגן משלנו אם טאביט יהדק את הגישה.
 *
 * העיקרון שנשאר תקף: מיזוג, לא דריסה. החלון מתגלגל ומראה בכל פעם חתך אחר של
 * אותו יום, ודריסה הייתה מוחקת את מה שכבר ראינו.
 *
 * ההגדרות כאן מכוילות למסנני הממשק של טאביט, בדיוק כמו בסוכן.
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
  /** מצב הפיקדון: שלושה מצבים, ראה missingDepositFooter ב-tabit-format.ts */
  deposit?: "secured" | "missing" | "none";
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

/**
 * אותן הגדרות בדיוק כמו בסוכן, ומכוילות למסנני הממשק של טאביט:
 * "לקוח לא הגיע" = כל רשומת no_show, "לקוח ביטל" = ביטול של לקוח אמיתי
 * (יש שם או טלפון) שאינו מזדמן.
 */
const CANCEL_REASONS = new Set(["customer_cancelled", "cancelled"]);
const SYSTEM_REASONS = new Set(["idle-temp-reservation"]);
const hasCustomer = (r: LedgerRecord) => !!((r.name && r.name.trim()) || (r.phone && r.phone.trim()));
/**
 * דלי "לקוח לא הגיע" של הממשק: כל סיבת ארכוב שאינה ביטול ואינה ניקוי מערכת.
 * אומת מול המסך ב-23.9 - 14 רשומות no_show ועוד אחת עם הסיבה "אחר" = 15.
 */
const isNoShowReason = (reason: string) => !!reason && !CANCEL_REASONS.has(reason) && !SYSTEM_REASONS.has(reason);

export interface DayOutcome {
  day: string;
  booked_total: number;
  no_show: number;
  cancelled: number;
  arrived: number;
  walk_ins: number;
  no_show_reservations: number;
  no_show_walkins: number;
  cancelled_without_customer: number;
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
  const noShow = onDay.filter((r) => isNoShowReason(r.reason));
  const cancelAll = onDay.filter((r) => CANCEL_REASONS.has(r.reason));
  const cancelled = cancelAll.filter((r) => hasCustomer(r) && !r.walkin);
  const arrived = booked.filter((r) => !r.reason);
  const sum = (a: LedgerRecord[]) => a.reduce((s, r) => s + (r.seats || 0), 0);
  const noShowBooked = noShow.filter((r) => !r.walkin);
  return {
    day,
    booked_total: booked.length,
    no_show: noShow.length,
    cancelled: cancelled.length,
    arrived: arrived.length,
    walk_ins: walkIns.length,
    no_show_reservations: noShowBooked.length,
    no_show_walkins: noShow.length - noShowBooked.length,
    cancelled_without_customer: cancelAll.filter((r) => !hasCustomer(r)).length,
    no_show_rate_pct: booked.length ? Math.round((noShowBooked.length / booked.length) * 1000) / 10 : 0,
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

/**
 * שורות ההזמנות של יום מהפנקס, בפורמט שרשימת היום מצפה לו.
 *
 * מסננת כמו הקריאה החיה: בלי מזדמנים ובלי ביטולים. אי-הגעה **כן** נשארת, כי
 * היא הייתה על הספרים באותו יום וזה מה שהצוות רוצה לראות בדיעבד.
 */
export function ledgerDayRows(records: LedgerRecord[], day: string) {
  return records
    .filter((r) => r.day === day && !r.walkin && r.reason !== "idle-temp-reservation" && !CANCEL_REASONS.has(r.reason))
    .map((r) => ({
      id: r.id, name: r.name, phone: r.phone, seats: r.seats,
      day: r.day, time: r.time, tables: r.tables, deposit: r.deposit ?? "none",
    }));
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
