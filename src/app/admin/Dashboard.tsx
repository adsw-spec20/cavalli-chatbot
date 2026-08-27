"use client";

import { useEffect, useState } from "react";
import { api, CHANNELS, type Stats } from "./types";
import type { InboxFilterIntent } from "./Inbox";

function Kpi({
  label,
  value,
  sub,
  accent,
  alert,
  onClick,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
  /** מדגיש כרטיס שדורש טיפול (כשהערך גדול מ-0) */
  alert?: boolean;
  onClick?: () => void;
}) {
  const highlight = alert && Number(value) > 0;
  const inner = (
    <>
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div className={`text-3xl font-bold mt-1 font-display tracking-tight ${highlight ? "text-red-400" : accent ? "text-[var(--accent)]" : ""}`} style={{ fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div className="text-[11px] text-[var(--muted)] mt-1">{sub}</div>}
    </>
  );
  if (onClick) {
    return (
      <button
        onClick={onClick}
        className={`text-right bg-[var(--panel)] border rounded-2xl p-4 transition hover:border-[var(--accent)] ${highlight ? "border-red-500/40" : "border-[var(--border)]"}`}
      >
        {inner}
        <div className="text-[10px] text-[var(--accent)] mt-1.5">לחץ לצפייה ←</div>
      </button>
    );
  }
  return <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-4">{inner}</div>;
}

export default function Dashboard({
  token,
  onOpenInbox,
  onOpenKnowledge,
  onOpenReservations,
}: {
  token: string;
  onOpenInbox: (intent: InboxFilterIntent) => void;
  onOpenKnowledge: () => void;
  onOpenReservations?: () => void;
}) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState("");
  // יומן השער (27.8): מי הבוט פתח לו את השער ומתי, כולל חסימות וכשלים
  const [gateLog, setGateLog] = useState<{
    events: Array<{ ts: number; customerName?: string; channel: string; result: string; detail: string }>;
    openedLast7Days: number;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<Stats>(token, "/stats")
        .then((s) => alive && setStats(s))
        .catch((e) => alive && setErr(e instanceof Error ? e.message : "שגיאה"));
    const loadGate = () =>
      api<{ events: []; openedLast7Days: number }>(token, "/gate-log")
        .then((g) => alive && setGateLog(g))
        .catch(() => {});
    load();
    loadGate();
    const t = setInterval(() => {
      load();
      loadGate();
    }, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [token]);

  if (err) return <div className="text-red-400 text-sm">{err}</div>;
  if (!stats) return <div className="text-[var(--muted)] text-sm">טוען נתונים…</div>;

  const maxDay = Math.max(1, ...stats.last7Days.map((d) => d.count));
  const maxHour = Math.max(1, ...stats.peakHours.map((h) => h.count));
  const maxChannel = Math.max(1, ...stats.byChannel.map((c) => c.count));
  const maxWord = Math.max(1, ...stats.topWords.map((w) => w.count));

  return (
    <div className="space-y-4 max-w-[1700px]">
      {/* KPI - כל כרטיס שדורש פעולה לחיץ ומוביל לרשימה המסוננת */}
      {(stats.pendingReservations ?? 0) > 0 && (
        <button
          onClick={onOpenReservations}
          className="w-full text-right bg-amber-500/10 border border-amber-500/40 rounded-2xl p-3 flex items-center justify-between hover:border-amber-400 transition"
        >
          <span className="text-sm font-semibold">🍽️ {stats.pendingReservations} בקשות הזמנה ממתינות לאישור</span>
          <span className="text-xs text-amber-300">לטיפול ←</span>
        </button>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          label="ממתינות למענה"
          value={stats.awaitingReplies}
          sub="ההודעה האחרונה של הלקוח"
          alert
          onClick={() => onOpenInbox({ status: "awaiting" })}
        />
        <Kpi
          label="אצל נציג"
          value={stats.needsAttention}
          sub="שיחות בטיפול אנושי"
          onClick={() => onOpenInbox({ status: "human" })}
        />
        <Kpi
          label="שאלות ללמידה"
          value={stats.openQuestions}
          sub="ממתינות לתשובת הצוות"
          alert
          onClick={onOpenKnowledge}
        />
        <Kpi label="הבוט פתר לבד" value={`${stats.deflectionRate}%`} sub={`מתוך ${stats.totalConversations} שיחות`} accent />
      </div>

      {/* 🅿️ יומן שער החניה (27.8): מי, מתי ומה קרה - נגזר מהודעות המערכת */}
      {gateLog && gateLog.events.length > 0 && (
        <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-sm">🅿️ פעילות שער החניה</h3>
            <span className="text-xs text-[var(--muted)]">
              {gateLog.openedLast7Days} פתיחות ב-7 הימים האחרונים
            </span>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {gateLog.events.slice(0, 50).map((e, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-xs border-b border-[var(--border)] last:border-0 py-1.5"
              >
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 font-semibold ${
                    e.result === "opened"
                      ? "bg-emerald-500/15 text-emerald-400"
                      : e.result === "error"
                        ? "bg-red-500/15 text-red-400"
                        : "bg-amber-500/15 text-amber-300"
                  }`}
                >
                  {e.result === "opened" ? "נפתח" : e.result === "error" ? "כשל" : "נחסם"}
                </span>
                <span className="font-medium truncate">{e.customerName || "לקוח"}</span>
                <span className="text-[var(--muted)] shrink-0">
                  {CHANNELS[e.channel]?.label ?? e.channel}
                </span>
                <span className="text-[var(--muted)] mr-auto whitespace-nowrap shrink-0">
                  {new Date(e.ts).toLocaleString("he-IL", {
                    timeZone: "Asia/Jerusalem",
                    day: "numeric",
                    month: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {/* 7 ימים */}
        <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-4">
          <div className="text-sm font-semibold mb-3">שיחות ב-7 הימים האחרונים</div>
          <div className="flex items-end gap-1.5 h-32">
            {stats.last7Days.map((d) => (
              <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
                <div className="text-[10px] text-[var(--muted)]">{d.count || ""}</div>
                <div
                  className="w-full bg-[var(--accent)] rounded-t-md transition-all"
                  style={{ height: `${(d.count / maxDay) * 100}%`, minHeight: d.count ? 4 : 0 }}
                />
                <div className="text-[9px] text-[var(--muted)]">{d.date.slice(5)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* פילוח ערוצים */}
        <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-4">
          <div className="text-sm font-semibold mb-3">פילוח לפי ערוץ</div>
          <div className="space-y-2.5">
            {stats.byChannel.length === 0 && <div className="text-xs text-[var(--muted)]">אין נתונים עדיין</div>}
            {stats.byChannel.map((c) => (
              <div key={c.channel} className="flex items-center gap-2">
                <span className="text-xs w-16 shrink-0">{CHANNELS[c.channel]?.label ?? c.channel}</span>
                <div className="flex-1 bg-[var(--panel2)] rounded-full h-2.5 overflow-hidden">
                  <div className={`h-full ${CHANNELS[c.channel]?.dot ?? "bg-neutral-500"}`} style={{ width: `${(c.count / maxChannel) * 100}%` }} />
                </div>
                <span className="text-xs text-[var(--muted)] w-6 text-left">{c.count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* פילוח נושאים - על מה שואלים */}
        <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-4 lg:col-span-2 xl:col-span-1">
          <div className="text-sm font-semibold mb-3">על מה שואלים (לפי נושא)</div>
          {(!stats.byTopic || stats.byTopic.length === 0) && (
            <div className="text-xs text-[var(--muted)]">אין נתונים עדיין</div>
          )}
          <div className="space-y-2">
            {(stats.byTopic ?? []).map((t) => {
              const maxTopic = Math.max(1, ...(stats.byTopic ?? []).map((x) => x.count));
              return (
                <div key={t.topic} className="flex items-center gap-2">
                  <span className="text-xs w-32 shrink-0">{t.topic}</span>
                  <div className="flex-1 bg-[var(--panel2)] rounded-full h-2.5 overflow-hidden">
                    <div className="h-full bg-[var(--accent)]" style={{ width: `${(t.count / maxTopic) * 100}%` }} />
                  </div>
                  <span className="text-xs text-[var(--muted)] w-8 text-left">{t.count}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* שעות עומס */}
        <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-4 lg:col-span-2 xl:col-span-3">
          <div className="text-sm font-semibold mb-3">שעות עומס (לפי שעון ישראל)</div>
          <div className="flex items-end gap-[3px] h-28">
            {stats.peakHours.map((h) => (
              <div key={h.hour} className="flex-1 flex flex-col items-center gap-1" title={`${h.hour}:00 — ${h.count} הודעות`}>
                <div
                  className="w-full bg-[var(--accent)]/70 rounded-t transition-all"
                  style={{ height: `${(h.count / maxHour) * 100}%`, minHeight: h.count ? 3 : 0 }}
                />
                {h.hour % 3 === 0 && <div className="text-[8px] text-[var(--muted)]">{h.hour}</div>}
              </div>
            ))}
          </div>
        </div>

        {/* מילים נפוצות */}
        <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-4 lg:col-span-2 xl:col-span-3">
          <div className="text-sm font-semibold mb-3">מילים נפוצות</div>
          {stats.topWords.length === 0 && <div className="text-xs text-[var(--muted)]">אין נתונים עדיין</div>}
          <div className="flex flex-wrap gap-2">
            {stats.topWords.map((w) => (
              <span
                key={w.word}
                className="rounded-full px-3 py-1 text-[var(--text)]"
                style={{
                  fontSize: `${0.75 + (w.count / maxWord) * 0.6}rem`,
                  background: "color-mix(in srgb, var(--accent) 14%, transparent)",
                }}
              >
                {w.word} <span className="text-[var(--muted)] text-xs">{w.count}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
