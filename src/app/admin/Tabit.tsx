"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, relTime } from "./types";
import { SectionCard } from "./ui";

/**
 * מסך "טאביט" - למנהל הראשי בלבד (מוגן פעמיים: השרת מחזיר רק ל-master,
 * והטאב מוסתר בפאנל למי שאינו master). קריאה בלבד: מציג snapshot חי של
 * ההזמנות מטאביט שהגשר המקומי שולח. אין כאן שום כתיבה חזרה לטאביט.
 *
 * שני הכאבים של ברק, אוטומטית:
 *  1) "למי לא נשלח קישור פיקדון" - כרטיס אדום בראש, לכל הימים הקרובים.
 *  2) "אילו שולחנות גדולים יש ביום X" - בורר יום + סף גודל.
 */

const WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

type Deposit = "sent" | "not_sent" | "none";

interface TabitReservation {
  id: string;
  name: string;
  phone: string;
  seats: number;
  fromISO: string;
  day: string; // YYYY-MM-DD (Asia/Jerusalem)
  time: string; // HH:MM (Asia/Jerusalem)
  tables: number[];
  state: string;
  type: string;
  deposit: Deposit;
}

interface Snapshot {
  generatedAt: number;
  receivedAt: number;
  reservations: TabitReservation[];
}

/** תאריך היום בישראל בפורמט YYYY-MM-DD */
function todayIL(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

/** "2026-09-02" -> "מחר · יום רביעי · 2.9" */
function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const base = `יום ${wd} · ${d}.${m}`;
  const today = todayIL();
  const tomorrow = new Date(new Date(today + "T12:00:00Z").getTime() + 86400000).toISOString().slice(0, 10);
  if (iso === today) return `היום · ${base}`;
  if (iso === tomorrow) return `מחר · ${base}`;
  return base;
}

/** תווית קצרה לבורר הימים */
function chipLabel(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  const today = todayIL();
  const tomorrow = new Date(new Date(today + "T12:00:00Z").getTime() + 86400000).toISOString().slice(0, 10);
  if (iso === today) return "היום";
  if (iso === tomorrow) return "מחר";
  const [y] = iso.split("-").map(Number);
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd.slice(0, 3)}׳ ${d}.${m}`;
}

const DEPOSIT_CHIP: Record<Deposit, { label: string; cls: string }> = {
  sent: { label: "פיקדון נשלח ✓", cls: "bg-emerald-500/15 text-emerald-400" },
  not_sent: { label: "פיקדון לא נשלח", cls: "bg-red-500/15 text-red-400" },
  none: { label: "ללא פיקדון", cls: "bg-[var(--panel2)] text-[var(--muted)]" },
};

const THRESHOLDS = [6, 8, 10, 12];

function PhoneLink({ phone }: { phone: string }) {
  if (!phone) return null;
  return (
    <a href={`tel:${phone}`} dir="ltr" className="text-[var(--accent)] underline text-sm">
      {phone}
    </a>
  );
}

function ReservationRow({ r }: { r: TabitReservation }) {
  const chip = DEPOSIT_CHIP[r.deposit];
  return (
    <div className="px-3.5 py-2.5 text-sm space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <b className="font-display" style={{ fontVariantNumeric: "tabular-nums" }}>
          {r.time}
        </b>
        <span className="font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>
          {r.seats} סועדים
        </span>
        <span className="truncate">· {r.name}</span>
        <span className={`text-[10px] px-2 py-0.5 rounded-full mr-auto shrink-0 ${chip.cls}`}>{chip.label}</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap text-xs text-[var(--muted)]">
        {r.tables.length > 0 && <span>שולחן {r.tables.join(", ")}</span>}
        <PhoneLink phone={r.phone} />
      </div>
    </div>
  );
}

export default function Tabit({ token }: { token: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [configured, setConfigured] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState("");
  const [threshold, setThreshold] = useState(8);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

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

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const reservations = useMemo(() => snapshot?.reservations ?? [], [snapshot]);

  /** הימים הקרובים שיש להם הזמנות (מהיום והלאה), ממוינים */
  const upcomingDays = useMemo(() => {
    const today = todayIL();
    const days = new Set<string>();
    for (const r of reservations) if (r.day && r.day >= today) days.add(r.day);
    return [...days].sort();
  }, [reservations]);

  // ברירת מחדל: מחר אם קיים, אחרת היום הקרוב ביותר שיש בו הזמנות
  useEffect(() => {
    if (selectedDay && upcomingDays.includes(selectedDay)) return;
    if (upcomingDays.length === 0) return;
    const today = todayIL();
    const tomorrow = new Date(new Date(today + "T12:00:00Z").getTime() + 86400000).toISOString().slice(0, 10);
    setSelectedDay(upcomingDays.includes(tomorrow) ? tomorrow : upcomingDays[0]);
  }, [upcomingDays, selectedDay]);

  /** פיקדונות שלא נשלחו, בכל הימים הקרובים - מהדחוף לרחוק */
  const missingDeposits = useMemo(() => {
    const today = todayIL();
    return reservations
      .filter((r) => r.deposit === "not_sent" && r.day >= today && r.state !== "cancelled")
      .sort((a, b) => (a.day === b.day ? b.seats - a.seats : a.day < b.day ? -1 : 1));
  }, [reservations]);

  /** ההזמנות של היום הנבחר, ממוינות מהגדול לקטן */
  const dayReservations = useMemo(() => {
    if (!selectedDay) return [];
    return reservations
      .filter((r) => r.day === selectedDay && r.state !== "cancelled")
      .sort((a, b) => b.seats - a.seats);
  }, [reservations, selectedDay]);

  const bigOfDay = useMemo(() => dayReservations.filter((r) => r.seats >= threshold), [dayReservations, threshold]);

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
              לטאביט, ולשלוח snapshot לשרת. {configured ? "הסוד מוגדר בשרת - צריך רק להריץ את הגשר." : "צריך להגדיר את TABIT_SYNC_SECRET בשרת ואז להריץ את הגשר."}
            </p>
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="space-y-3 max-w-[900px]">
      {/* שורת סטטוס: מתי עודכן לאחרונה */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className={`rounded-full px-2.5 py-1 ${stale ? "bg-amber-500/15 text-amber-500" : "bg-emerald-500/15 text-emerald-400"}`}>
          {stale ? "⚠ " : "● "}עודכן {relTime(snapshot.generatedAt)}
        </span>
        {stale && <span className="text-[var(--muted)]">ייתכן שהגשר לא רץ כרגע - הנתונים אולי לא מעודכנים.</span>}
        <span className="text-[var(--muted)] mr-auto">{reservations.length} הזמנות בנתונים</span>
      </div>

      {/* ===== פיקדונות חסרים - הכאב של ברק ===== */}
      <SectionCard
        title="פיקדונות שלא נשלחו"
        badge={missingDeposits.length}
        badgeCls={missingDeposits.length > 0 ? "bg-red-500/15 text-red-400" : "bg-emerald-500/15 text-emerald-400"}
        sub="הזמנות קרובות שיש להן קישור פיקדון בטאביט אבל הוא עדיין לא נשלח ללקוח"
      >
        {missingDeposits.length === 0 ? (
          <div className="text-sm text-[var(--muted)] text-center py-4">הכל שלח 🎉 אין פיקדונות תלויים.</div>
        ) : (
          <div className="rounded-xl border border-red-500/25 overflow-hidden divide-y divide-[var(--border)]">
            {missingDeposits.map((r) => (
              <div key={r.id} className="px-3.5 py-2.5 text-sm space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <b className="font-display">{dayLabel(r.day)}</b>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>· {r.time}</span>
                  <span className="font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>
                    · {r.seats} סועדים
                  </span>
                  <span className="truncate">· {r.name}</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <PhoneLink phone={r.phone} />
                  {r.tables.length > 0 && <span className="text-[var(--muted)]">שולחן {r.tables.join(", ")}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* ===== שולחנות גדולים ליום נבחר ===== */}
      <SectionCard title="שולחנות גדולים" sub="בחר יום וסף גודל - כדי לענות מיד ל'אילו שולחנות גדולים יש'">
        {/* בורר יום */}
        <div className="flex gap-1.5 flex-wrap mb-3">
          {upcomingDays.length === 0 && <span className="text-sm text-[var(--muted)]">אין הזמנות קרובות בנתונים.</span>}
          {upcomingDays.map((iso) => {
            const on = iso === selectedDay;
            return (
              <button
                key={iso}
                onClick={() => setSelectedDay(iso)}
                aria-current={on ? "page" : undefined}
                className={`rounded-xl px-3 py-2 text-sm border transition ${
                  on
                    ? "bg-[var(--accent)] text-[var(--accent-fg)] border-transparent font-semibold"
                    : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
                }`}
              >
                {chipLabel(iso)}
              </button>
            );
          })}
        </div>

        {/* סף גודל */}
        {selectedDay && (
          <div className="flex items-center gap-2 mb-3 text-sm">
            <span className="text-[var(--muted)]">גדול =</span>
            {THRESHOLDS.map((n) => (
              <button
                key={n}
                onClick={() => setThreshold(n)}
                className={`rounded-lg px-2.5 py-1 border text-xs ${
                  threshold === n
                    ? "bg-[var(--accent)] text-[var(--accent-fg)] border-transparent font-semibold"
                    : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
                }`}
              >
                {n}+
              </button>
            ))}
            <span className="text-[var(--muted)] mr-auto text-xs">
              {selectedDay ? `${dayReservations.length} הזמנות ביום · ${bigOfDay.length} גדולות` : ""}
            </span>
          </div>
        )}

        {/* רשימה */}
        {selectedDay && (
          <div className="rounded-xl border border-[var(--border)] overflow-hidden">
            <div className="px-3.5 py-2 text-xs font-semibold border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]">
              {dayLabel(selectedDay)}
            </div>
            {bigOfDay.length === 0 ? (
              <div className="text-sm text-[var(--muted)] text-center py-5">אין שולחנות של {threshold}+ סועדים ביום הזה.</div>
            ) : (
              <div className="divide-y divide-[var(--border)]">
                {bigOfDay.map((r) => (
                  <ReservationRow key={r.id} r={r} />
                ))}
              </div>
            )}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
