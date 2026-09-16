"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, relTime } from "./types";
import { SectionCard } from "./ui";
import { coversByTimeSlot } from "@/lib/tabit-chart";
import { EVENING_MIN, waDateParts, renderReservationList } from "@/lib/tabit-format";

/**
 * מסך "טאביט" - לכל הצוות (נפתח 15.9). קריאה בלבד: מציג snapshot חי של
 * ההזמנות מטאביט שהגשר המקומי שולח. אין כאן שום כתיבה חזרה לטאביט
 * (חוץ משליחת תזכורת פיקדון בוואטסאפ - שהיא הודעה מהבוט שלנו, לא כתיבה לטאביט).
 *
 * תצוגה יום-מרכזית: בוחרים יום למעלה, וכל המסך (מדדים, גרף עומס,
 * חסר-פיקדון, יומן ההזמנות) מתייחס ליום הנבחר. לחיצה על הזמנה פותחת מגירת פרטים.
 */

const WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

// מצב הפיקדון, תואם לטאביט: מובטח / חסר / ללא. נקבע לפי cc_deposit בגשר.
type Deposit = "secured" | "missing" | "none";

interface TabitReservation {
  id: string;
  name: string;
  phone: string;
  seats: number;
  fromISO: string;
  untilISO?: string | null;
  day: string; // YYYY-MM-DD (Asia/Jerusalem)
  time: string; // HH:MM (Asia/Jerusalem)
  tables: number[];
  state: string;
  type: string;
  deposit: Deposit;
  notes?: string;
  manageUrl?: string | null;
  depositLink?: string | null;
  /** מתי נשלחה תזכורת פיקדון (אם נשלחה) - מצורף בשרת */
  reminderSentAt?: number | null;
}

/** דשבורד משמרת "היום" - מגיע מעושר ב-snapshot מהגשר (computeDashboard). */
interface Dashboard {
  arrived_count: number;
  arrived_covers: number;
  expected_count: number;
  expected_covers: number;
  walkins_count: number;
  walkins_covers: number;
  occupancy_pct: number;
  missing_deposit: number;
  cancelled_count: number;
}

interface Snapshot {
  generatedAt: number;
  receivedAt: number;
  reservations: TabitReservation[];
  dashboard?: Dashboard;
}

/** תאריך היום בישראל בפורמט YYYY-MM-DD */
function todayIL(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}
function tomorrowIL(): string {
  return new Date(new Date(todayIL() + "T12:00:00Z").getTime() + 86400000).toISOString().slice(0, 10);
}
/** דקות מחצות, שעון ישראל */
function nowMinIL(): number {
  const t = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** "2026-09-02" -> "מחר · יום רביעי · 2.9" */
function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const base = `יום ${wd} · ${d}.${m}`;
  if (iso === todayIL()) return `היום · ${base}`;
  if (iso === tomorrowIL()) return `מחר · ${base}`;
  return base;
}

/** תווית דו-שורתית קצרה לצ'יפ יום */
function chipLabel(iso: string): { top: string; bottom: string } {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  if (iso === todayIL()) return { top: "היום", bottom: `${d}.${m}` };
  if (iso === tomorrowIL()) return { top: "מחר", bottom: `${d}.${m}` };
  return { top: `יום ${wd}`, bottom: `${d}.${m}` };
}

const DEPOSIT_CHIP: Record<Deposit, { label: string; cls: string }> = {
  secured: { label: "פיקדון מובטח ✓", cls: "bg-emerald-500/15 text-emerald-400" },
  missing: { label: "חסר פיקדון", cls: "bg-red-500/15 text-red-400" },
  none: { label: "ללא פיקדון", cls: "bg-[var(--panel2)] text-[var(--muted)]" },
};
const FALLBACK_CHIP = { label: "—", cls: "bg-[var(--panel2)] text-[var(--muted)]" };

const THRESHOLDS = [6, 8, 10, 12];

/** מספר ישראלי -> קישור וואטסאפ, או null */
function waLink(phone: string): string | null {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.startsWith("972") && digits.length >= 11) return `https://wa.me/${digits}`;
  if (digits.startsWith("0") && digits.length >= 9) return `https://wa.me/972${digits.slice(1)}`;
  return null;
}

/** מספר ישראלי נייד -> 05X-XXX-XXXX. אחרת מחזיר כמו שהוא. */
function fmtPhone(p: string): string {
  const d = (p || "").replace(/\D/g, "").replace(/^972/, "0");
  return /^0\d{9}$/.test(d) ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : (p || "").trim();
}

/** "9.9 · 17:32" - מתי נשלחה תזכורת הפיקדון */
function fmtSentAt(ts: number): string {
  const d = new Date(ts);
  const day = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return `${day} · ${time}`;
}

const firstName = (n: string) => (n || "").trim().split(/\s+/)[0] || "";
const toMin = (hhmm: string): number => {
  const [h, m] = (hhmm || "").split(":").map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : -1;
};
const ilTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hour12: false });

// ===== העתקה לוואטסאפ =====
// הפורמט עצמו עבר ל-src/lib/tabit-format.ts (17.9) כדי שצ'אט המעבדה, שרץ
// בשרת, יוכל להחזיר בדיוק את אותה רשימה. קודם הוא היה כאן בלבד, והמעבדה
// הרכיבה פורמט משלה בכל תשובה - ובדרך גם השמיטה שורות.

function PhoneActions({ phone, wa = true }: { phone: string; wa?: boolean }) {
  if (!phone) return null;
  const w = wa ? waLink(phone) : null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <a href={`tel:${phone}`} dir="ltr" className="text-[var(--accent)] underline text-sm">
        {phone}
      </a>
      {w && (
        <a
          href={w}
          target="_blank"
          rel="noopener noreferrer"
          title="שלח וואטסאפ ללקוח"
          className="text-[10px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 rounded-full px-2 py-0.5"
        >
          וואטסאפ
        </a>
      )}
    </span>
  );
}

/** אריח מדד ליום הנבחר, עם כפתור העתקה לוואטסאפ (כשיש מה להעתיק) והערת אזהרה אופציונלית */
function StatTile({ label, value, tone, note, onCopy, copied }: { label: string; value: ReactNode; tone?: "danger" | "accent"; note?: string; onCopy?: () => void; copied?: boolean }) {
  const valueCls = tone === "danger" ? "text-red-400" : tone === "accent" ? "text-[var(--accent)]" : "text-[var(--text)]";
  return (
    <div className="relative bg-[var(--panel)] border border-[var(--border)] rounded-xl px-3 py-2.5">
      {onCopy && (
        <button
          onClick={onCopy}
          title="מעתיק את הרשימה בפורמט וואטסאפ"
          className={`absolute top-1.5 left-1.5 text-[10px] rounded-md px-1.5 py-0.5 border transition ${
            copied ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10" : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
          }`}
        >
          {copied ? "הועתק ✓" : "📋 העתק"}
        </button>
      )}
      <div className={`text-2xl font-bold font-display ${valueCls}`} style={{ fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
      <div className="text-[11px] text-[var(--muted)] mt-0.5">{label}</div>
      {note && <div className="text-[10px] font-semibold text-red-400 mt-0.5">{note}</div>}
    </div>
  );
}

function NotesLine({ notes }: { notes?: string }) {
  if (!notes) return null;
  return (
    <div className="text-xs bg-amber-500/10 border border-amber-500/20 text-[var(--text)] rounded-lg px-2.5 py-1 inline-flex items-start gap-1 max-w-full">
      <span aria-hidden>💬</span>
      <span className="truncate">{notes}</span>
    </div>
  );
}

/** גרף עומס: עמודות סועדים לפי פרוסות 30 דק', עם קו "עכשיו" כשהיום הנבחר הוא היום. */
function RushChart({ reservations, nowMin }: { reservations: { time: string; seats: number }[]; nowMin?: number | null }) {
  const points = coversByTimeSlot(reservations, 30);
  if (points.length < 2) return null;
  const max = Math.max(...points.map((p) => p.value), 1);
  const firstMin = toMin(points[0].label);
  const spanMin = points.length * 30;
  const linePct =
    nowMin != null && firstMin >= 0 && nowMin >= firstMin && nowMin <= firstMin + spanMin
      ? ((nowMin - firstMin) / spanMin) * 100
      : null;
  return (
    <div className="bg-[var(--panel)] border border-[var(--border)] rounded-xl p-3">
      <div className="text-[11px] text-[var(--muted)] mb-2">עומס לפי שעה (סועדים)</div>
      <div className="relative">
        <div className="flex items-end gap-1 h-28">
          {points.map((p) => (
            <div key={p.label} className="flex-1 flex flex-col items-center justify-end gap-1 h-full min-w-0">
              {p.value > 0 && (
                <span className="text-[9px] text-[var(--muted)]" style={{ fontVariantNumeric: "tabular-nums" }}>{p.value}</span>
              )}
              <div
                className="w-full rounded-t bg-[var(--accent)]"
                style={{ height: `${Math.max(2, (p.value / max) * 100)}%` }}
                title={`${p.label} · ${p.value} סועדים`}
              />
            </div>
          ))}
        </div>
        {linePct != null && (
          <div className="absolute top-0 bottom-0 pointer-events-none" style={{ insetInlineStart: `${linePct}%` }}>
            <div className="w-px h-full bg-red-400/80" />
            <div className="absolute top-0 text-[8px] text-red-400 px-0.5">עכשיו</div>
          </div>
        )}
      </div>
      <div className="flex gap-1 mt-1">
        {points.map((p, i) => (
          <span key={p.label} className="flex-1 text-center text-[8px] text-[var(--muted)] min-w-0" style={{ fontVariantNumeric: "tabular-nums" }}>
            {i % 2 === 0 ? p.label : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function Tabit({ token, agentName }: { token: string; agentName?: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [configured, setConfigured] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState("");

  const [threshold, setThreshold] = useState(8);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [view, setView] = useState<"all" | "big">("all");
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const [copiedTile, setCopiedTile] = useState<"all" | "covers" | "big" | "missing" | null>(null);

  // מגירת פרטי הזמנה + שליחת תזכורת פיקדון מתוכה
  const [selectedRes, setSelectedRes] = useState<TabitReservation | null>(null);
  const [reminderConfirm, setReminderConfirm] = useState(false);
  const [reminderBusy, setReminderBusy] = useState(false);
  const [reminderMsg, setReminderMsg] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await api<{ configured: boolean; snapshot: Snapshot | null }>(token, "/tabit");
      setConfigured(d.configured);
      setSnapshot(d.snapshot);
      setErr("");
      setLoaded(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "טעינה נכשלה");
      setLoaded(true);
    }
  }, [token]);

  // כמו במסך ההזמנות: סוקרים רק כשהמסך גלוי, ומושכים מיד בחזרה מרקע (6.9)
  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 30_000);
    const onWake = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onWake);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [load]);

  /** רענון חי: מבקש מהסוכן snapshot עכשיו (עד ~20 שנ') ואז מושך מחדש */
  async function manualRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshNote("");
    try {
      await api(token, "/tabit/refresh", { method: "POST", body: "{}" });
    } catch {
      setRefreshNote("הסוכן לא זמין כרגע - מוצג העדכון האחרון");
    }
    await load();
    setRefreshing(false);
  }

  function openRes(r: TabitReservation) {
    setSelectedRes(r);
    setReminderConfirm(false);
    setReminderMsg("");
  }

  async function sendReminder(r: TabitReservation) {
    if (!r.depositLink || reminderBusy) return;
    setReminderBusy(true);
    try {
      await api(token, "/tabit/send-deposit-reminder", {
        method: "POST",
        body: JSON.stringify({ phone: r.phone, link: r.depositLink, name: r.name, agentName, reservationId: r.id }),
      });
      setReminderMsg("✅ נשלחה תזכורת פיקדון בוואטסאפ");
      setSelectedRes({ ...r, reminderSentAt: Date.now() });
    } catch (e) {
      setReminderMsg(`⚠ ${e instanceof Error ? e.message : "השליחה נכשלה"}`);
    } finally {
      setReminderBusy(false);
      setReminderConfirm(false);
    }
  }

  // שליחת תזכורת ישירות משורת "חסר פיקדון" - אותה התנהגות בדיוק כמו
  // כפתור הפיקדון בתיבת הפניות: אישור דו-שלבי, "נשלח ✓", ו"שלח שוב".
  const [rowConfirmId, setRowConfirmId] = useState<string | null>(null);
  const [rowSendingId, setRowSendingId] = useState<string | null>(null);
  const [rowSent, setRowSent] = useState<Record<string, "ok" | string>>({});

  async function sendRowReminder(r: TabitReservation) {
    if (!r.depositLink) return;
    setRowSendingId(r.id);
    try {
      await api(token, "/tabit/send-deposit-reminder", {
        method: "POST",
        body: JSON.stringify({ phone: r.phone, link: r.depositLink, name: r.name, agentName, reservationId: r.id }),
      });
      setRowSent((s) => ({ ...s, [r.id]: "ok" }));
    } catch (e) {
      setRowSent((s) => ({ ...s, [r.id]: e instanceof Error ? e.message : "השליחה נכשלה" }));
    } finally {
      setRowSendingId(null);
      setRowConfirmId(null);
    }
  }

  const reservations = useMemo(
    () => (snapshot?.reservations ?? []).filter((r) => r.state !== "cancelled"),
    [snapshot]
  );

  /** הימים הקרובים שיש להם הזמנות (מהיום והלאה), + מונה לכל יום */
  const upcomingDays = useMemo(() => {
    const today = todayIL();
    const m = new Map<string, number>();
    for (const r of reservations) if (r.day && r.day >= today) m.set(r.day, (m.get(r.day) || 0) + 1);
    return [...m.entries()].map(([iso, count]) => ({ iso, count })).sort((a, b) => (a.iso < b.iso ? -1 : 1));
  }, [reservations]);

  // ברירת מחדל: היום (upcomingDays ממוין מהיום והלאה, אז הראשון הוא היום אם יש בו הזמנות)
  useEffect(() => {
    if (selectedDay && upcomingDays.some((d) => d.iso === selectedDay)) return;
    if (upcomingDays.length === 0) return;
    setSelectedDay(upcomingDays[0].iso);
  }, [upcomingDays, selectedDay]);

  /** כל הזמנות היום הנבחר, ממוינות לפי שעה */
  const dayAll = useMemo(() => {
    if (!selectedDay) return [];
    return reservations.filter((r) => r.day === selectedDay).sort((a, b) => (a.fromISO < b.fromISO ? -1 : 1));
  }, [reservations, selectedDay]);

  const dayBig = useMemo(() => dayAll.filter((r) => r.seats >= threshold), [dayAll, threshold]);
  /** כמה מהשולחנות הגדולים בלי פיקדון מובטח - מוצג על האריח עצמו */
  const bigMissing = useMemo(() => dayBig.filter((r) => r.deposit === "missing").length, [dayBig]);
  const dayMissing = useMemo(() => {
    return dayAll.filter((r) => r.deposit === "missing").sort((a, b) => b.seats - a.seats);
  }, [dayAll]);

  const covers = useMemo(() => dayAll.reduce((s, r) => s + r.seats, 0), [dayAll]);

  /** חסרי פיקדון בשאר הימים הקרובים (לא היום הנבחר) - רק כמספר, לרמז */
  const otherDaysMissing = useMemo(() => {
    const today = todayIL();
    return reservations.filter((r) => r.deposit === "missing" && r.day >= today && r.day !== selectedDay).length;
  }, [reservations, selectedDay]);

  /** הרשימה המוצגת באג'נדה: הכל או גדולות, + חיפוש */
  const agenda = useMemo(() => {
    const base = view === "big" ? dayBig : dayAll;
    const q = query.trim();
    if (!q) return base;
    return base.filter((r) =>
      [r.name, r.phone, r.notes, r.tables.join(",")].filter(Boolean).some((v) => String(v).includes(q))
    );
  }, [view, dayBig, dayAll, query]);

  /** "העתק רשימה" למארחות: שם · שולחן · טלפון (אותו פורמט כמו ה-webhook) */
  function copyRoster() {
    const lines = dayAll.map(
      (r) => `${r.name || "(ללא שם)"} · שולחן ${r.tables.length ? r.tables.join("+") : "?"} · ${fmtPhone(r.phone) || "-"}`
    );
    const label = selectedDay ? dayLabel(selectedDay) : "";
    const text = `*רשימת אורחים - ${label}*\n\n${lines.join("\n")}\n\nסה״כ ${dayAll.length} הזמנות · תוסיפו מזדמנים`;
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }).catch(() => {});
  }

  // ===== העתקות וואטסאפ מהאריחים - רשימות מלאות של היום הנבחר =====

  function copyTile(text: string, key: "all" | "covers" | "big" | "missing") {
    navigator.clipboard?.writeText(text).then(() => {
      setCopiedTile(key);
      setTimeout(() => setCopiedTile((c) => (c === key ? null : c)), 1800);
    }).catch(() => {});
  }

  /** כל ההזמנות של היום הנבחר, מקובץ בוקר/ערב */
  function copyDayAll() {
    if (!selectedDay || !dayAll.length) return;
    // אותה פונקציה בדיוק שצ'אט המעבדה משתמש בה - כך הפורמט זהה ולא "דומה"
    const text = renderReservationList({ title: "כל ההזמנות", dayISO: selectedDay, list: dayAll, covers });
    copyTile(text, "all");
  }

  /** סיכום סועדים: תמונת מצב מספרית של היום, בלי רשימה */
  function copyCovers() {
    if (!selectedDay || !dayAll.length) return;
    const { ref, date } = waDateParts(selectedDay);
    const morning = dayAll.filter((r) => toMin(r.time) < EVENING_MIN);
    const evening = dayAll.filter((r) => toMin(r.time) >= EVENING_MIN);
    const sum = (l: TabitReservation[]) => l.reduce((s, r) => s + r.seats, 0);
    const slots = coversByTimeSlot(dayAll.map((r) => ({ time: r.time, seats: r.seats })), 30);
    const peak = slots.reduce((best, p) => (p.value > best.value ? p : best), { label: "", value: 0 });
    const lines = [
      `*סיכום סועדים ${ref}* (${date})`,
      "",
      `סה״כ *${covers} סועדים* ב-${dayAll.length} הזמנות`,
    ];
    if (morning.length) lines.push(`🌅 בוקר: ${sum(morning)} סועדים · ${morning.length} הזמנות`);
    if (evening.length) lines.push(`🌆 ערב: ${sum(evening)} סועדים · ${evening.length} הזמנות`);
    lines.push("");
    lines.push(`🍽️ שולחנות גדולים (${threshold}+): ${dayBig.length}${dayBig.length ? ` · ${sum(dayBig)} סועדים` : ""}`);
    lines.push(`💳 חסרי פיקדון: ${dayMissing.length}`);
    if (peak.value > 0) lines.push(`⏰ שעת שיא: ${peak.label} · ${peak.value} סועדים`);
    copyTile(lines.join("\n"), "covers");
  }

  /** שולחנות גדולים: הפורמט המלא שהמנהל ביקש - קיבוץ בוקר/ערב + שורת סיכום */
  function copyDayBig() {
    if (!selectedDay || !dayBig.length) return;
    const { ref, date } = waDateParts(selectedDay);
    const seats = dayBig.reduce((s, r) => s + r.seats, 0);
    const missing = dayBig.filter((r) => r.deposit === "missing").length;
    const foot =
      missing > 0
        ? `❌ ${missing} הזמנות חסרות פיקדון`
        : dayBig.every((r) => r.deposit === "secured")
          ? "✅ כל ההזמנות עם פיקדון מובטח"
          : "";
    const text = renderReservationList({
      title: "שולחנות גדולים",
      dayISO: selectedDay,
      list: dayBig,
      summaryNoun: "שולחנות גדולים",
      covers: seats,
      footer: foot || undefined,
    });
    copyTile(text, "big");
  }

  /** חסרי פיקדון: רשימה לפי שעה, כולל אם כבר נשלחה תזכורת */
  function copyDayMissing() {
    if (!selectedDay || !dayMissing.length) return;
    const { ref, date } = waDateParts(selectedDay);
    const byTime = [...dayMissing].sort((a, b) => (a.fromISO < b.fromISO ? -1 : 1));
    const seats = byTime.reduce((s, r) => s + r.seats, 0);
    const blocks = byTime.map((r) => {
      const tables = r.tables.length ? `ש׳ ${r.tables.join(",")}` : "ללא שולחן";
      const lines = [
        `*${r.time} · ${r.name || "(ללא שם)"} · ${r.seats} סועדים*`,
        `${tables} | ${fmtPhone(r.phone) || "-"}`,
      ];
      if (r.reminderSentAt) lines.push(`💳 נשלחה תזכורת · ${fmtSentAt(r.reminderSentAt)}`);
      if (r.notes) lines.push(`💬 ${r.notes}`);
      return lines.join("\n");
    });
    const text = [
      `*חסרי פיקדון ${ref}* (${date})`,
      `${byTime.length} הזמנות · ${seats} סועדים`,
      "",
      blocks.join("\n\n"),
      "",
      `💳 לשליחת תזכורת: כפתור "פיקדון" בפאנל`,
    ].join("\n");
    copyTile(text, "missing");
  }

  const stale = snapshot ? Date.now() - snapshot.generatedAt > 20 * 60_000 : false;

  // ===== מצבי קצה =====
  if (!loaded) return <div className="text-sm text-[var(--muted)] p-4">טוען…</div>;
  if (err) return <div className="text-sm text-red-400 p-2">⚠ {err}</div>;

  if (!configured || !snapshot) {
    return (
      <div className="max-w-[700px]">
        <SectionCard title="טאביט עדיין לא מחובר">
          <div className="text-sm text-[var(--muted)] space-y-2 leading-relaxed">
            <p>המסך הזה מציג הזמנות חיות מטאביט, אבל עדיין לא הגיע מידע.</p>
            <p>
              הגשר המקומי (<code className="text-[var(--text)]">tabit-automation</code>) צריך לרוץ במחשב שמחובר
              לטאביט ולשלוח snapshot לשרת.{" "}
              {configured ? "הסוד מוגדר בשרת - צריך רק להריץ את הגשר." : "צריך להגדיר את TABIT_SYNC_SECRET בשרת ואז להריץ את הגשר."}
            </p>
          </div>
        </SectionCard>
      </div>
    );
  }

  const selLabel = selectedDay ? dayLabel(selectedDay) : "";
  const isTodaySelected = selectedDay === todayIL();

  return (
    <div className="space-y-4 max-w-[1000px]">
      {/* ===== שורת סטטוס ===== */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className={`rounded-full px-2.5 py-1 ${stale ? "bg-amber-500/15 text-amber-500" : "bg-emerald-500/15 text-emerald-400"}`}>
          {stale ? "⚠ " : "● "}עודכן {relTime(snapshot.generatedAt)}
        </span>
        {stale && <span className="text-[var(--muted)]">ייתכן שהגשר לא רץ כרגע.</span>}
        <span className="text-[var(--muted)]">{reservations.length} הזמנות קרובות</span>
        {refreshNote && <span className="text-amber-500">{refreshNote}</span>}
        <button
          onClick={manualRefresh}
          disabled={refreshing}
          className="mr-auto rounded-lg px-2.5 py-1 border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-60"
        >
          {refreshing ? "מושך מטאביט… (עד 20 שנ')" : "🔄 רענון חי"}
        </button>
      </div>

      {/* ===== בורר יום ===== */}
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
        {upcomingDays.length === 0 && <span className="text-sm text-[var(--muted)]">אין הזמנות קרובות בנתונים.</span>}
        {upcomingDays.map(({ iso, count }) => {
          const on = iso === selectedDay;
          const cl = chipLabel(iso);
          return (
            <button
              key={iso}
              onClick={() => setSelectedDay(iso)}
              aria-current={on ? "page" : undefined}
              className={`shrink-0 rounded-xl px-3 py-1.5 border text-center leading-tight transition ${
                on
                  ? "bg-[var(--accent)] text-[var(--accent-fg)] border-transparent font-semibold"
                  : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              <div className="text-[13px]">{cl.top}</div>
              <div className="text-[10px] opacity-80" style={{ fontVariantNumeric: "tabular-nums" }}>
                {cl.bottom} · {count}
              </div>
            </button>
          );
        })}
      </div>

      {selectedDay && (
        <>
          {/* ===== מדדי היום ===== */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <StatTile label="הזמנות ביום" value={dayAll.length} onCopy={dayAll.length ? copyDayAll : undefined} copied={copiedTile === "all"} />
            <StatTile label="סה״כ סועדים" value={covers} onCopy={dayAll.length ? copyCovers : undefined} copied={copiedTile === "covers"} />
            <StatTile
              label={`שולחנות גדולים (${threshold}+)`}
              value={dayBig.length}
              tone="accent"
              note={bigMissing > 0 ? `${bigMissing} מתוכם ללא פיקדון` : undefined}
              onCopy={dayBig.length ? copyDayBig : undefined}
              copied={copiedTile === "big"}
            />
            <StatTile label="חסרי פיקדון" value={dayMissing.length} tone={dayMissing.length > 0 ? "danger" : undefined} onCopy={dayMissing.length ? copyDayMissing : undefined} copied={copiedTile === "missing"} />
          </div>

          {/* ===== דשבורד משמרת חי (רק כשהיום הנבחר הוא היום) =====
              "כבר הגיעו" ו"מזדמנים היום" הוסרו (15.9): הם נספרו מהפיד החי של
              טאביט, שמוחק הזמנות שסיימו - אז המספרים ירדו במהלך היום והטעו.
              נשארו רק שני המדדים האמינים. */}
          {isTodaySelected && snapshot.dashboard && (
            <div className="grid grid-cols-2 gap-2">
              <StatTile label="עוד צפויים (סועדים)" value={snapshot.dashboard.expected_covers} tone="accent" />
              <StatTile label="תפוסה כרגע" value={`${snapshot.dashboard.occupancy_pct}%`} />
            </div>
          )}

          {/* ===== גרף עומס ===== */}
          {dayAll.length > 1 && (
            <RushChart
              reservations={dayAll.map((r) => ({ time: r.time, seats: r.seats }))}
              nowMin={isTodaySelected ? nowMinIL() : null}
            />
          )}

          {/* ===== חסר פיקדון - ליום הנבחר ===== */}
          <SectionCard
            title="חסר פיקדון"
            badge={dayMissing.length}
            badgeCls={dayMissing.length > 0 ? "bg-red-500/15 text-red-400" : "bg-emerald-500/15 text-emerald-400"}
            sub={`${selLabel} · הזמנות שדורשות פיקדון אך הוא לא מובטח בטאביט`}
          >
            {dayMissing.length === 0 ? (
              <div className="text-sm text-[var(--muted)] text-center py-4">כל ההזמנות ביום הזה עם פיקדון מובטח 🎉</div>
            ) : (
              <div className="rounded-xl border border-red-500/25 overflow-hidden divide-y divide-[var(--border)]">
                {dayMissing.map((r) => {
                  const state = rowSent[r.id];
                  const isConfirming = rowConfirmId === r.id;
                  return (
                    <div key={r.id} onClick={() => openRes(r)} className="px-3.5 py-2.5 text-sm space-y-1.5 cursor-pointer hover:bg-[var(--panel2)] transition">
                      <div className="flex items-center gap-2 flex-wrap">
                        <b className="font-display" style={{ fontVariantNumeric: "tabular-nums" }}>{r.time}</b>
                        <span className="font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>· {r.seats} סועדים</span>
                        <span className="truncate">· {r.name}</span>
                        {r.tables.length > 0 && <span className="text-xs text-[var(--muted)]">· שולחן {r.tables.join(", ")}</span>}
                        <span className="mr-auto shrink-0" onClick={(e) => e.stopPropagation()}>
                          {state === "ok" ? (
                            <span className="text-xs text-emerald-400 font-semibold">נשלח ✓</span>
                          ) : isConfirming ? (
                            <span className="inline-flex gap-1">
                              <button
                                onClick={() => sendRowReminder(r)}
                                disabled={rowSendingId === r.id}
                                className="text-xs font-semibold rounded-lg px-2.5 py-1 bg-[var(--accent)] text-[var(--accent-fg)] disabled:opacity-50"
                              >
                                {rowSendingId === r.id ? "שולח…" : "כן, שלח"}
                              </button>
                              <button onClick={() => setRowConfirmId(null)} className="text-xs rounded-lg px-2 py-1 border border-[var(--border)] text-[var(--muted)]">
                                לא
                              </button>
                            </span>
                          ) : (
                            <button
                              onClick={() => setRowConfirmId(r.id)}
                              disabled={!r.depositLink}
                              title={r.depositLink ? "שלח תזכורת פיקדון בוואטסאפ" : "אין קישור פיקדון (הפעל מחדש את הסוכן)"}
                              className="text-xs rounded-lg px-2.5 py-1 border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-40"
                            >
                              {r.reminderSentAt ? "💳 שלח שוב" : "💳 שלח"}
                            </button>
                          )}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
                        <PhoneActions phone={r.phone} />
                        {r.reminderSentAt && (
                          <span className="text-[10px] text-amber-500">💳 נשלחה תזכורת · {fmtSentAt(r.reminderSentAt)}</span>
                        )}
                      </div>
                      {typeof state === "string" && state !== "ok" && <div className="text-[11px] text-red-400">⚠ {state}</div>}
                      {r.notes && <NotesLine notes={r.notes} />}
                    </div>
                  );
                })}
              </div>
            )}
            {otherDaysMissing > 0 && (
              <p className="text-[11px] text-[var(--muted)] mt-2 text-center">
                יש עוד {otherDaysMissing} חסרי פיקדון בימים אחרים - בחר יום אחר למעלה כדי לראות.
              </p>
            )}
          </SectionCard>

          {/* ===== יומן ההזמנות של היום הנבחר ===== */}
          <SectionCard
            title="יומן הזמנות"
            sub={selLabel}
            actions={
              <button
                onClick={copyRoster}
                title="מעתיק את רשימת המארחות: שם · שולחן · טלפון"
                className="text-xs rounded-lg px-2.5 py-1 border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
              >
                {copied ? "הועתק ✓" : "📋 העתק רשימה"}
              </button>
            }
          >
            {/* מתג תצוגה + חיפוש */}
            <div className="flex items-center gap-2 flex-wrap mb-3">
              <div className="inline-flex rounded-xl border border-[var(--border)] overflow-hidden">
                {(["all", "big"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={`px-3 py-1.5 text-sm ${
                      view === v ? "bg-[var(--accent)] text-[var(--accent-fg)] font-semibold" : "text-[var(--muted)] hover:text-[var(--text)]"
                    }`}
                  >
                    {v === "all" ? `הכל (${dayAll.length})` : `גדולות (${dayBig.length})`}
                  </button>
                ))}
              </div>
              {view === "big" && (
                <div className="inline-flex items-center gap-1 text-xs">
                  <span className="text-[var(--muted)]">מ־</span>
                  {THRESHOLDS.map((n) => (
                    <button
                      key={n}
                      onClick={() => setThreshold(n)}
                      className={`rounded-lg px-2 py-1 border ${
                        threshold === n
                          ? "bg-[var(--accent)] text-[var(--accent-fg)] border-transparent font-semibold"
                          : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
                      }`}
                    >
                      {n}+
                    </button>
                  ))}
                </div>
              )}
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="חיפוש שם / טלפון / שולחן…"
                aria-label="חיפוש בהזמנות היום"
                className="mr-auto min-w-40 flex-1 bg-[var(--panel)] border border-[var(--border)] rounded-xl px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
              />
            </div>

            {agenda.length === 0 ? (
              <div className="bg-[var(--panel)] border border-[var(--border)] rounded-xl p-6 text-center text-sm text-[var(--muted)]">
                {query ? "אין תוצאות לחיפוש" : view === "big" ? `אין שולחנות של ${threshold}+ ביום הזה` : "אין הזמנות ביום הזה"}
              </div>
            ) : (
              <div className="rounded-xl border border-[var(--border)] overflow-hidden divide-y divide-[var(--border)]">
                {agenda.map((r) => {
                  const chip = DEPOSIT_CHIP[r.deposit] ?? FALLBACK_CHIP;
                  const big = r.seats >= threshold;
                  return (
                    <div key={r.id} onClick={() => openRes(r)} className="px-3.5 py-2.5 text-sm space-y-1.5 cursor-pointer hover:bg-[var(--panel2)] transition">
                      <div className="flex items-center gap-2 flex-wrap">
                        <b className="font-display w-12 shrink-0" style={{ fontVariantNumeric: "tabular-nums" }}>{r.time}</b>
                        <span
                          className={`text-xs font-bold rounded-md px-1.5 py-0.5 shrink-0 ${
                            big ? "bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] text-[var(--accent)]" : "bg-[var(--panel2)] text-[var(--muted)]"
                          }`}
                          style={{ fontVariantNumeric: "tabular-nums" }}
                        >
                          {r.seats}
                        </span>
                        <span className="truncate font-medium">{r.name || "(ללא שם)"}</span>
                        {r.tables.length > 0 && (
                          <span className="text-xs text-[var(--muted)]">שולחן {r.tables.join(", ")}</span>
                        )}
                        <span className={`text-[10px] px-2 py-0.5 rounded-full mr-auto shrink-0 ${chip.cls}`}>{chip.label}</span>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap ps-14" onClick={(e) => e.stopPropagation()}>
                        <PhoneActions phone={r.phone} />
                        {r.notes && <NotesLine notes={r.notes} />}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        </>
      )}

      {/* ===== מגירת פרטי הזמנה ===== */}
      {selectedRes && (
        <div className="fixed inset-x-0 bottom-0 z-50 p-3 pointer-events-none">
          <div className="pointer-events-auto mx-auto max-w-md bg-[var(--panel)] border border-[var(--border)] rounded-2xl shadow-xl p-4 space-y-2.5">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold font-display text-base truncate">{selectedRes.name || "(ללא שם)"}</h3>
              <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${(DEPOSIT_CHIP[selectedRes.deposit] ?? FALLBACK_CHIP).cls}`}>
                {(DEPOSIT_CHIP[selectedRes.deposit] ?? FALLBACK_CHIP).label}
              </span>
              <button onClick={() => setSelectedRes(null)} className="mr-auto text-[var(--muted)] hover:text-[var(--text)] rounded-lg px-2 py-1 border border-[var(--border)] text-sm shrink-0">✕</button>
            </div>

            <div className="text-sm text-[var(--muted)]" style={{ fontVariantNumeric: "tabular-nums" }}>
              {dayLabel(selectedRes.day)} · {selectedRes.time}
              {selectedRes.untilISO ? ` עד ${ilTime(selectedRes.untilISO)}` : ""} · {selectedRes.seats} סועדים
              {selectedRes.tables.length > 0 && ` · שולחן ${selectedRes.tables.join("+")}`}
            </div>

            <div className="flex items-center gap-2 flex-wrap text-sm">
              <PhoneActions phone={selectedRes.phone} />
            </div>
            {selectedRes.notes && <NotesLine notes={selectedRes.notes} />}
            {selectedRes.reminderSentAt && (
              <div className="text-[11px] text-amber-500">💳 נשלחה תזכורת פיקדון · {fmtSentAt(selectedRes.reminderSentAt)}</div>
            )}

            <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-[var(--border)]">
              {selectedRes.manageUrl && (
                <a
                  href={selectedRes.manageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs rounded-lg px-3 py-1.5 border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                >
                  🔗 פתח בטאביט
                </a>
              )}
              {selectedRes.deposit === "missing" && selectedRes.depositLink && (
                reminderMsg ? (
                  <span className="text-xs">{reminderMsg}</span>
                ) : reminderConfirm ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-xs text-[var(--muted)]">לשלוח ל{firstName(selectedRes.name) || "לקוח"} ({fmtPhone(selectedRes.phone)})?</span>
                    <button
                      onClick={() => sendReminder(selectedRes)}
                      disabled={reminderBusy}
                      className="text-xs font-semibold rounded-lg px-2.5 py-1.5 bg-[var(--accent)] text-[var(--accent-fg)] disabled:opacity-50"
                    >
                      {reminderBusy ? "שולח…" : "כן, שלח"}
                    </button>
                    <button onClick={() => setReminderConfirm(false)} className="text-xs rounded-lg px-2 py-1.5 border border-[var(--border)] text-[var(--muted)]">
                      ביטול
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setReminderConfirm(true)}
                    className="text-xs rounded-lg px-3 py-1.5 border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  >
                    {selectedRes.reminderSentAt ? "💳 שלח תזכורת שוב" : "💳 שלח תזכורת פיקדון"}
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
