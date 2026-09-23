/**
 * שכבת הנתונים של מעבדת טאביט: מאיפה מגיע כל נתון, כמה הוא טרי, ואיך אומרים
 * את זה בעברית.
 *
 * שתי בעיות נפרדות נפתרות כאן, ושתיהן היו גלויות לצוות:
 *
 * 1. **איטיות.** כל שאלה עברה דרך תור אל הסוכן המקומי, שסורק עד כל 15 שניות
 *    במצב שקט. שאלה על ההזמנות של היום לקחה 5-20 שניות, למרות שתצלום טרי של
 *    אותן הזמנות בדיוק יושב במסד הנתונים ומתעדכן כל 5 דקות. מעכשיו קריאות של
 *    היום והעתיד נענות מהתצלום (~200ms), והסוכן נדרש רק למה שבאמת חייב להיות
 *    חי ברגע זה (מצב רצפה, זמינות) או שלא נמצא בתצלום בכלל (ימי עבר, ארכיון).
 *
 * 2. **חוסר שקיפות.** מספר הגיע בלי מקור, בלי טווח ובלי גיל, ולכן לא היה אפשר
 *    לאמת אותו. כל קריאה מחזירה עכשיו גם ייחוס (provenance) שנבנה בקוד, והוא
 *    זה שמייצר את שורת המקור מתחת לתשובה. המודל לא כותב אותה ולא יכול לסלף
 *    אותה.
 */

import { runCommand, type TabitAction } from "./tabit-queue";
import {
  renderReservationList,
  filterByTimeRange,
  scopeNoteFor,
  type TabitResRow,
} from "./tabit-format";
import {
  loadSnapshot, snapshotAgeMinutes, weekdayHe, todayIL, addDaysISO,
  type LabResRow, type SnapshotData,
} from "./tabit-lab-smart";
import { readLedgerDay, ledgerIsComplete, ledgerDayRows } from "./tabit-ledger";

// ===== טריות =====

/**
 * הסוכן דוחף תצלום כל 5 דקות. עד 8 דקות זה "טרי" (מרווח לסבב שהתאחר קצת).
 * מעבר לזה עוברים לקריאה חיה - עדיף להמתין מאשר לענות על נתון ישן בלי לדעת.
 */
export const SNAPSHOT_FRESH_MIN = 8;
/** מעל זה התצלום כבר לא משמש בכלל, גם לא כרשת ביטחון שקטה. */
export const SNAPSHOT_STALE_MIN = 30;

export function nowHHMM(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date());
}

/** "היום", "מחר", "אתמול", או "יום רביעי 23.9" */
export function dayLabelHe(dayISO: string, todayISO = todayIL()): string {
  const [, m, d] = dayISO.split("-").map(Number);
  const named = `יום ${weekdayHe(dayISO)} ${d}.${m}`;
  if (dayISO === todayISO) return `היום, ${named}`;
  if (dayISO === addDaysISO(todayISO, 1)) return `מחר, ${named}`;
  if (dayISO === addDaysISO(todayISO, -1)) return `אתמול, ${named}`;
  return named;
}

// ===== ייחוס =====

export type DataSource = "snapshot" | "live" | "archive" | "ledger" | "none";

export interface Provenance {
  /** שם הכלי בעברית, כפי שיופיע לצוות */
  toolLabel: string;
  /** על מה נשאל: "יום רביעי 23.9" / "25.8 עד 24.9" / "עכשיו" */
  scopeLabel: string;
  source: DataSource;
  /** גיל הנתונים בדקות, כשהוא ידוע ורלוונטי (תצלום בלבד) */
  ageMinutes?: number | null;
}

const SOURCE_HE: Record<DataSource, string> = {
  snapshot: "תצלום טאביט",
  live: "טאביט חי",
  archive: "ארכיון טאביט",
  // הפנקס היומי שלנו. קיים כי טאביט שומר 24 שעות בלבד, ולכן לימים ישנים זה
  // המקור היחיד - והצוות צריך לדעת שזה מה שנקרא.
  ledger: "תיעוד יומי שלנו",
  none: "ללא נתונים",
};

export const TOOL_LABEL_HE: Record<string, string> = {
  tabit_health: "בדיקת חיבור",
  tabit_read_day: "הזמנות היום",
  tabit_big_tables: "שולחנות גדולים",
  tabit_covers_summary: "ספירת סועדים",
  tabit_deposit_summary: "פיקדונות",
  tabit_get_deposit_link: "קישור פיקדון",
  tabit_check_availability: "בדיקת זמינות",
  tabit_customer_lookup: "פרופיל לקוח",
  tabit_find_reservation: "חיפוש הזמנה",
  tabit_table_schedule: "לוח שולחן",
  tabit_tables_status: "מצב רצפה",
  tabit_day_outcome: "אי-הגעות וביטולים ליום",
  tabit_no_show_summary: "אי-הגעות וביטולים לתקופה",
  tabit_booking_sources: "מקורות הזמנה",
  tabit_revenue: "הכנסות",
  tabit_shift_dashboard: "דשבורד משמרת",
  tabit_notification_status: "מה נשלח ללקוח",
};

/**
 * שורת המקור שנוספת מתחת לתשובה. נבנית **בקוד** מתוך הקריאות שבאמת רצו, ולכן
 * היא לא יכולה לתאר בדיקה שלא קרתה. זו התשובה לשאלה "איך אני מוודא בעצמי".
 */
export function buildSourceFooter(provs: Provenance[], at = nowHHMM()): string {
  if (!provs.length) return "";
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const p of provs) {
    const age =
      p.source === "snapshot" && p.ageMinutes != null
        ? p.ageMinutes < 1 ? "עכשיו" : `לפני ${p.ageMinutes} דק'`
        : "";
    const key = `${p.toolLabel}|${p.scopeLabel}|${p.source}|${age}`;
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push([p.toolLabel, p.scopeLabel, SOURCE_HE[p.source] + (age ? ` (${age})` : "")].filter(Boolean).join(" · "));
  }
  return `_נבדק ב-${at} · ${parts.join(" | ")}_`;
}

// ===== מטמון ארכיון =====

/**
 * ימי עבר לא משתנים (כמעט), אבל כל קריאה אליהם היא סבב מלא אל הסוכן ואל
 * טאביט - שניות רבות. שאלת המשך על אותו יום ("ומי בדיוק ביטל?") שילמה את
 * המחיר פעמיים. המטמון חי בזיכרון המופע, וזה מספיק: הוא נועד לשיחה, לא לימים.
 */
interface CacheEntry { at: number; value: unknown }
const archiveCache = new Map<string, CacheEntry>();
const ARCHIVE_TTL_TODAY_MS = 90_000;      // היום עוד זז
const ARCHIVE_TTL_SETTLED_MS = 15 * 60_000; // יום שנסגר

export function clearArchiveCache(): void {
  archiveCache.clear();
}

/** קריאה לסוכן עם מטמון לפי יום. יום עתידי/חי לא נכנס למטמון. */
export async function cachedAgentCall(
  action: TabitAction,
  params: Record<string, unknown>,
  dayISO: string | null,
  timeoutMs = 45_000
): Promise<unknown> {
  const today = todayIL();
  const cacheable = !!dayISO && dayISO <= today;
  const key = `${action}:${JSON.stringify(params)}`;
  if (cacheable) {
    const hit = archiveCache.get(key);
    const ttl = dayISO === today ? ARCHIVE_TTL_TODAY_MS : ARCHIVE_TTL_SETTLED_MS;
    if (hit && Date.now() - hit.at < ttl) return hit.value;
  }
  const value = await runCommand(action, params, timeoutMs);
  if (cacheable) archiveCache.set(key, { at: Date.now(), value });
  return value;
}

// ===== קריאת יום מהתצלום =====

export interface DayRowsResult {
  rows: LabResRow[];
  source: DataSource;
  ageMinutes: number | null;
}

/** האם התצלום ראוי לשימוש לשאלה על היום/העתיד */
function snapshotUsable(snap: SnapshotData | null): { ok: boolean; age: number | null } {
  const age = snapshotAgeMinutes(snap);
  if (!snap?.reservations || age == null) return { ok: false, age };
  return { ok: age <= SNAPSHOT_FRESH_MIN, age };
}

/**
 * שורות ההזמנות של יום, מהמקור המהיר ביותר שעדיין נכון.
 *
 * היום והעתיד: התצלום, אם הוא טרי. אחרת סבב חי אל הסוכן.
 * העבר: הארכיון דרך הסוכן (התצלום מחזיק רק את הפיד החי).
 */
export async function dayRows(dayISO: string): Promise<DayRowsResult> {
  const today = todayIL();
  if (dayISO < today) {
    // הפנקס שלנו קודם: הארכיון של טאביט נגיש ליממה בלבד, ולכן לרוב ימי העבר
    // הוא המקור היחיד שיש. נופלים לטאביט רק כשאין פנקס אמין ליום הזה.
    const entry = await readLedgerDay(dayISO);
    if (entry?.records.length && ledgerIsComplete(entry)) {
      return { rows: ledgerDayRows(entry.records, dayISO) as LabResRow[], source: "ledger", ageMinutes: null };
    }
    const res = (await cachedAgentCall("read_day", { day: dayISO }, dayISO)) as { reservations?: LabResRow[] };
    return { rows: res.reservations ?? [], source: "archive", ageMinutes: null };
  }

  const snap = await loadSnapshot();
  const { ok, age } = snapshotUsable(snap);
  if (ok && snap) {
    const rows = (snap.reservations ?? []).filter((r) => r.day === dayISO && r.state !== "cancelled");
    return { rows, source: "snapshot", ageMinutes: age };
  }

  // התצלום ישן או חסר: קוראים חי. אם גם זה נכשל ויש תצלום ישן אבל לא עתיק,
  // עדיף להחזיר אותו עם גיל מוצהר מאשר לא לענות בכלל.
  try {
    const res = (await runCommand("read_day", { day: dayISO }, 45_000)) as { reservations?: LabResRow[] };
    return { rows: res.reservations ?? [], source: "live", ageMinutes: 0 };
  } catch (e) {
    if (snap?.reservations && age != null && age <= SNAPSHOT_STALE_MIN) {
      const rows = snap.reservations.filter((r) => r.day === dayISO && r.state !== "cancelled");
      return { rows, source: "snapshot", ageMinutes: age };
    }
    throw e;
  }
}

/** כל שורות ההזמנות הזמינות (לחיפוש חוצה-ימים), מהתצלום או חי */
export async function allUpcomingRows(): Promise<DayRowsResult> {
  const snap = await loadSnapshot();
  const { ok, age } = snapshotUsable(snap);
  if (ok && snap) return { rows: snap.reservations ?? [], source: "snapshot", ageMinutes: age };
  try {
    const res = (await runCommand("read_day", { day: "today" }, 45_000)) as { reservations?: LabResRow[] };
    // read_day מחזיר יום אחד בלבד; לחיפוש רחב התצלום הוא המקור, גם אם ישן.
    if (snap?.reservations && age != null && age <= SNAPSHOT_STALE_MIN) {
      return { rows: snap.reservations, source: "snapshot", ageMinutes: age };
    }
    return { rows: res.reservations ?? [], source: "live", ageMinutes: 0 };
  } catch {
    if (snap?.reservations) return { rows: snap.reservations, source: "snapshot", ageMinutes: age };
    throw new Error("אין נתוני הזמנות זמינים כרגע - התצלום ריק והסוכן המקומי לא הגיב");
  }
}

// ===== חישובי יום, כולם בקוד =====

export interface DayViewOptions {
  dayISO: string;
  from?: string;
  to?: string;
  /** מסנן מינימום סועדים (שולחנות גדולים) */
  minSeats?: number;
  /** רק חסרי פיקדון */
  missingDepositOnly?: boolean;
  title: string;
  summaryNoun?: string;
}

export interface DayTotals {
  count: number;
  covers: number;
  secured: number;
  missing_deposit: number;
  no_deposit_required: number;
}

export interface DayView extends DayTotals {
  day: string;
  weekday_he: string;
  day_label: string;
  scope_kind: "day";
  reservations: TabitResRow[];
  rendered: string;
  filtered_range?: string;
  /** המספרים של היום **כולו**, לפני כל סינון. */
  day_totals: DayTotals;
  source: DataSource;
  data_age_minutes: number | null;
}

function totalsOf(list: TabitResRow[]): DayTotals {
  return {
    count: list.length,
    covers: list.reduce((s, r) => s + (r.seats ?? 0), 0),
    secured: list.filter((r) => r.deposit === "secured").length,
    missing_deposit: list.filter((r) => r.deposit === "missing").length,
    no_deposit_required: list.filter((r) => r.deposit === "none").length,
  };
}

/**
 * הליבה הטהורה: שורות נכנסות, תצוגה יוצאת. אין כאן רשת, מסד נתונים או שעון,
 * ולכן אפשר לבדוק אותה אופליין עם נתוני דמה (scripts/tabit-format-test.mts).
 */
export function composeDayView(
  rows: TabitResRow[],
  o: DayViewOptions,
  meta: { source: DataSource; ageMinutes: number | null; todayISO?: string }
): DayView {
  const dayList: TabitResRow[] = rows.filter((r) => r.day === o.dayISO);

  let list = dayList;
  if (o.minSeats != null) list = list.filter((r) => (r.seats ?? 0) >= o.minSeats!);
  if (o.missingDepositOnly) list = list.filter((r) => r.deposit === "missing");
  const scope = scopeNoteFor(o.from, o.to);
  if (o.from || o.to) list = filterByTimeRange(list, o.from, o.to);
  list = [...list].sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));

  const totals = totalsOf(list);
  return {
    day: o.dayISO,
    weekday_he: weekdayHe(o.dayISO),
    day_label: dayLabelHe(o.dayISO, meta.todayISO),
    scope_kind: "day",
    ...totals,
    reservations: list,
    rendered: renderReservationList({
      title: o.title,
      dayISO: o.dayISO,
      list,
      summaryNoun: o.summaryNoun,
      scopeNote: scope || undefined,
      covers: totals.covers,
      todayISO: meta.todayISO,
    }),
    ...(scope ? { filtered_range: scope } : {}),
    day_totals: totalsOf(dayList),
    source: meta.source,
    data_age_minutes: meta.ageMinutes,
  };
}

/**
 * התצוגה המלאה של יום: שליפה מהמקור המהיר ביותר שעדיין נכון, ואז חישוב טהור.
 * המודל מקבל מספרים גמורים ובלוק טקסט, ואין לו מה לחשב או לקצר.
 *
 * day_totals נשמר בנפרד בכוונה: "5 שולחנות גדולים" בלי "מתוך 23 הזמנות" גרם
 * לצוות להבין שזה כל מה שיש באותו יום.
 */
export async function buildDayView(o: DayViewOptions): Promise<DayView> {
  const { rows, source, ageMinutes } = await dayRows(o.dayISO);
  return composeDayView(rows, o, { source, ageMinutes });
}
