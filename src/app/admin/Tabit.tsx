"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, relTime } from "./types";
import { SectionCard } from "./ui";

/**
 * מסך "טאביט" - למנהל הראשי בלבד (מוגן פעמיים: השרת מחזיר רק ל-master,
 * והטאב מוסתר בפאנל למי שאינו master). קריאה בלבד: מציג snapshot חי של
 * ההזמנות מטאביט שהגשר המקומי שולח. אין כאן שום כתיבה חזרה לטאביט.
 *
 * תצוגה יום-מרכזית: בוחרים יום למעלה, וכל המסך (מדדים, חסר-פיקדון, אג'נדה)
 * מתייחס ליום הנבחר.
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
  day: string; // YYYY-MM-DD (Asia/Jerusalem)
  time: string; // HH:MM (Asia/Jerusalem)
  tables: number[];
  state: string;
  type: string;
  deposit: Deposit;
  notes?: string;
  manageUrl?: string | null;
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
function tomorrowIL(): string {
  return new Date(new Date(todayIL() + "T12:00:00Z").getTime() + 86400000).toISOString().slice(0, 10);
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

/** אריח מדד ליום הנבחר */
function StatTile({ label, value, tone }: { label: string; value: ReactNode; tone?: "danger" | "accent" }) {
  const valueCls = tone === "danger" ? "text-red-400" : tone === "accent" ? "text-[var(--accent)]" : "text-[var(--text)]";
  return (
    <div className="bg-[var(--panel)] border border-[var(--border)] rounded-xl px-3 py-2.5">
      <div className={`text-2xl font-bold font-display ${valueCls}`} style={{ fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
      <div className="text-[11px] text-[var(--muted)] mt-0.5">{label}</div>
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

export default function Tabit({ token }: { token: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [configured, setConfigured] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const [threshold, setThreshold] = useState(8);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [view, setView] = useState<"all" | "big">("all");
  const [query, setQuery] = useState("");

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

  async function manualRefresh() {
    setRefreshing(true);
    const started = Date.now();
    await load();
    const wait = 400 - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    setRefreshing(false);
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

  // ברירת מחדל: מחר אם קיים, אחרת היום הקרוב ביותר
  useEffect(() => {
    if (selectedDay && upcomingDays.some((d) => d.iso === selectedDay)) return;
    if (upcomingDays.length === 0) return;
    const t = tomorrowIL();
    setSelectedDay(upcomingDays.some((d) => d.iso === t) ? t : upcomingDays[0].iso);
  }, [upcomingDays, selectedDay]);

  /** כל הזמנות היום הנבחר, ממוינות לפי שעה */
  const dayAll = useMemo(() => {
    if (!selectedDay) return [];
    return reservations.filter((r) => r.day === selectedDay).sort((a, b) => (a.fromISO < b.fromISO ? -1 : 1));
  }, [reservations, selectedDay]);

  const dayBig = useMemo(() => dayAll.filter((r) => r.seats >= threshold), [dayAll, threshold]);
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

  return (
    <div className="space-y-4 max-w-[1000px]">
      {/* ===== שורת סטטוס ===== */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className={`rounded-full px-2.5 py-1 ${stale ? "bg-amber-500/15 text-amber-500" : "bg-emerald-500/15 text-emerald-400"}`}>
          {stale ? "⚠ " : "● "}עודכן {relTime(snapshot.generatedAt)}
        </span>
        {stale && <span className="text-[var(--muted)]">ייתכן שהגשר לא רץ כרגע.</span>}
        <span className="text-[var(--muted)]">{reservations.length} הזמנות קרובות</span>
        <button
          onClick={manualRefresh}
          disabled={refreshing}
          className="mr-auto rounded-lg px-2.5 py-1 border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-60"
        >
          {refreshing ? "מרענן…" : "↻ רענן"}
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
            <StatTile label="הזמנות ביום" value={dayAll.length} />
            <StatTile label="סה״כ סועדים" value={covers} />
            <StatTile label={`שולחנות גדולים (${threshold}+)`} value={dayBig.length} tone="accent" />
            <StatTile label="חסרי פיקדון" value={dayMissing.length} tone={dayMissing.length > 0 ? "danger" : undefined} />
          </div>

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
                {dayMissing.map((r) => (
                  <div key={r.id} className="px-3.5 py-2.5 text-sm space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <b className="font-display" style={{ fontVariantNumeric: "tabular-nums" }}>{r.time}</b>
                      <span className="font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>· {r.seats} סועדים</span>
                      <span className="truncate">· {r.name}</span>
                      {r.tables.length > 0 && <span className="text-xs text-[var(--muted)]">· שולחן {r.tables.join(", ")}</span>}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <PhoneActions phone={r.phone} />
                    </div>
                    {r.notes && <NotesLine notes={r.notes} />}
                  </div>
                ))}
              </div>
            )}
            {otherDaysMissing > 0 && (
              <p className="text-[11px] text-[var(--muted)] mt-2 text-center">
                יש עוד {otherDaysMissing} חסרי פיקדון בימים אחרים - בחר יום אחר למעלה כדי לראות.
              </p>
            )}
          </SectionCard>

          {/* ===== אג'נדת היום ===== */}
          <SectionCard title="אג׳נדת היום" sub={selLabel}>
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
                    <div key={r.id} className="px-3.5 py-2.5 text-sm space-y-1.5">
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
                      <div className="flex items-center gap-2 flex-wrap ps-14">
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
    </div>
  );
}
