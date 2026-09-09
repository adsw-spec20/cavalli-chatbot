"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./types";
import { SectionCard } from "./ui";

/**
 * תזכורת פיקדון (מרכז טאביט, מנהל בלבד): מחפשים הזמנה לפי שם/טלפון, בוחרים,
 * מאשרים בדיאלוג - והלקוח מקבל בוואטסאפ הודעה אחת עם קישור התשלום האמיתי של
 * ההזמנה (תבנית payment_reminder_v3, משתנה {{1}} = הקישור). קריאה מה-snapshot
 * (בלי סבב לסוכן), שליחה דרך /api/admin/tabit/send-deposit-reminder.
 */

const WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

interface Res {
  id: string;
  name: string;
  phone: string;
  seats: number;
  day: string; // YYYY-MM-DD
  time: string; // HH:MM
  deposit: "secured" | "missing" | "none";
  depositLink?: string | null;
}
interface Snapshot {
  generatedAt: number;
  reservations: Res[];
}

function todayIL(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}
function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y) return iso;
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return iso === todayIL() ? "היום" : `יום ${wd} ${d}.${m}`;
}
function fmtPhone(p: string): string {
  const d = (p || "").replace(/\D/g, "").replace(/^972/, "0");
  return /^0\d{9}$/.test(d) ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : (p || "").trim();
}
const last9 = (p: string) => (p || "").replace(/\D/g, "").slice(-9);

export default function DepositReminder({ token, agentName }: { token: string; agentName?: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState("");
  const [query, setQuery] = useState("");
  const [confirm, setConfirm] = useState<Res | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<{ snapshot: Snapshot | null }>(token, "/tabit");
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
  }, [load]);

  const reservations = useMemo(
    () => (snapshot?.reservations ?? []).filter((r) => r.day >= todayIL()),
    [snapshot]
  );

  // בלי חיפוש: מציג את חסרי הפיקדון הקרובים (נקודת פתיחה טבעית). עם חיפוש: כל התאמה.
  const matches = useMemo(() => {
    const q = query.trim();
    const base = q
      ? reservations.filter((r) => r.name?.includes(q) || (last9(r.phone) && last9(r.phone).includes(last9(q))))
      : reservations.filter((r) => r.deposit === "missing");
    return base.sort((a, b) => (a.day + a.time < b.day + b.time ? -1 : 1)).slice(0, 40);
  }, [reservations, query]);

  async function send(r: Res) {
    if (!r.depositLink) return;
    setSending(true);
    setResult(null);
    try {
      await api(token, "/tabit/send-deposit-reminder", {
        method: "POST",
        body: JSON.stringify({ phone: r.phone, link: r.depositLink, name: r.name, agentName }),
      });
      setResult({ ok: true, text: `✅ נשלחה תזכורת פיקדון ל${r.name || "לקוח"} (${fmtPhone(r.phone)})` });
    } catch (e) {
      setResult({ ok: false, text: `⚠ ${e instanceof Error ? e.message : "השליחה נכשלה"}` });
    } finally {
      setSending(false);
      setConfirm(null);
    }
  }

  if (!loaded) return <div className="text-sm text-[var(--muted)] p-4">טוען…</div>;
  if (err) return <div className="text-sm text-red-400 p-2">⚠ {err}</div>;

  return (
    <div className="space-y-4 max-w-[760px]">
      <SectionCard
        title="תזכורת פיקדון"
        sub="חיפוש הזמנה לפי שם או טלפון, ואישור לפני שליחה. הלקוח יקבל בוואטסאפ הודעה אחת עם קישור התשלום של ההזמנה."
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="חיפוש שם או טלפון…"
          aria-label="חיפוש הזמנה"
          className="w-full bg-[var(--panel2)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
        />

        {result && (
          <div className={`mt-3 text-sm rounded-xl px-3 py-2 ${result.ok ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/25" : "bg-red-500/10 text-red-300 border border-red-500/25"}`}>
            {result.text}
          </div>
        )}

        <div className="mt-3">
          {!query && <p className="text-[11px] text-[var(--muted)] mb-2">הזמנות קרובות שחסר בהן פיקדון (חפשו כדי למצוא הזמנה אחרת):</p>}
          {matches.length === 0 ? (
            <div className="text-sm text-[var(--muted)] text-center py-6">{query ? "אין תוצאות לחיפוש" : "אין הזמנות קרובות ללא פיקדון 🎉"}</div>
          ) : (
            <div className="rounded-xl border border-[var(--border)] overflow-hidden divide-y divide-[var(--border)]">
              {matches.map((r) => {
                const canSend = !!r.depositLink;
                return (
                  <div key={r.id} className="px-3.5 py-2.5 flex items-center gap-2 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{r.name || "(ללא שם)"}</div>
                      <div className="text-xs text-[var(--muted)]" style={{ fontVariantNumeric: "tabular-nums" }}>
                        {dayLabel(r.day)} {r.time} · {r.seats} סועדים · <span dir="ltr">{fmtPhone(r.phone)}</span>
                      </div>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${r.deposit === "missing" ? "bg-red-500/15 text-red-400" : r.deposit === "secured" ? "bg-emerald-500/15 text-emerald-400" : "bg-[var(--panel2)] text-[var(--muted)]"}`}>
                      {r.deposit === "missing" ? "חסר פיקדון" : r.deposit === "secured" ? "פיקדון מובטח" : "ללא פיקדון"}
                    </span>
                    <button
                      onClick={() => { setResult(null); setConfirm(r); }}
                      disabled={!canSend}
                      title={canSend ? "שלח תזכורת פיקדון" : "אין קישור פיקדון להזמנה זו"}
                      className="shrink-0 text-xs rounded-lg px-3 py-1.5 border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-40"
                    >
                      💳 שלח תזכורת
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SectionCard>

      {/* דיאלוג אישור */}
      {confirm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={() => !sending && setConfirm(null)}>
          <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-5 max-w-sm w-full space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm leading-relaxed">
              לשלוח ל<b>{confirm.name || "לקוח"}</b> (<span dir="ltr">{fmtPhone(confirm.phone)}</span>) תזכורת פיקדון בוואטסאפ עם קישור התשלום?
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirm(null)} disabled={sending} className="text-sm rounded-xl px-4 py-2 border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-50">
                ביטול
              </button>
              <button onClick={() => send(confirm)} disabled={sending} className="text-sm font-semibold rounded-xl px-4 py-2 bg-[var(--accent)] text-[var(--accent-fg)] disabled:opacity-50">
                {sending ? "שולח…" : "כן, שלח"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
