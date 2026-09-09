"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./types";

/**
 * חלון "פיקדון" (מתיבת הפניות, נגיש לצוות): רשימת כל ההזמנות שחסר בהן פיקדון,
 * מקובצת לפי יום (היום, מחר, מחרתיים, ...) וממוינת לפי שעה. המארחת בוחרת שורה
 * או מחפשת, מאשרת, והלקוח מקבל בוואטסאפ תזכורת עם קישור התשלום של ההזמנה.
 * מקור: /api/admin/tabit/missing-deposits. שליחה: /api/admin/tabit/send-deposit-reminder.
 */

const WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

interface MissRes {
  id: string;
  name: string;
  phone: string;
  day: string; // YYYY-MM-DD
  time: string; // HH:MM
  seats: number;
  depositLink: string | null;
}

const todayIL = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function dayLabel(iso: string): string {
  const t = todayIL();
  if (iso === t) return "היום";
  if (iso === addDays(t, 1)) return "מחר";
  if (iso === addDays(t, 2)) return "מחרתיים";
  const [y, m, d] = iso.split("-").map(Number);
  return `יום ${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d}.${m}`;
}
function fmtPhone(p: string): string {
  const d = (p || "").replace(/\D/g, "").replace(/^972/, "0");
  return /^0\d{9}$/.test(d) ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : (p || "").trim();
}
const last9 = (p: string) => (p || "").replace(/\D/g, "").slice(-9);

export default function DepositPanel({
  token,
  agentName,
  onClose,
}: {
  token: string;
  agentName?: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<MissRes[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState("");
  const [query, setQuery] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sent, setSent] = useState<Record<string, "ok" | string>>({});

  const load = useCallback(async () => {
    try {
      const d = await api<{ reservations: MissRes[] }>(token, "/tabit/missing-deposits");
      setRows(d.reservations || []);
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "טעינה נכשלה");
    } finally {
      setLoaded(true);
    }
  }, [token]);
  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return rows;
    return rows.filter((r) => r.name?.includes(q) || (last9(r.phone) && last9(r.phone).includes(last9(q))));
  }, [rows, query]);

  // מקובץ לפי יום, בסדר תאריכים (הרשימה כבר ממוינת יום+שעה מהשרת)
  const groups = useMemo(() => {
    const out: { day: string; items: MissRes[] }[] = [];
    for (const r of filtered) {
      const last = out[out.length - 1];
      if (last && last.day === r.day) last.items.push(r);
      else out.push({ day: r.day, items: [r] });
    }
    return out;
  }, [filtered]);

  const noLinks = loaded && rows.length > 0 && rows.every((r) => !r.depositLink);

  async function send(r: MissRes) {
    if (!r.depositLink) return;
    setSendingId(r.id);
    try {
      await api(token, "/tabit/send-deposit-reminder", {
        method: "POST",
        body: JSON.stringify({ phone: r.phone, link: r.depositLink, name: r.name, agentName }),
      });
      setSent((s) => ({ ...s, [r.id]: "ok" }));
    } catch (e) {
      setSent((s) => ({ ...s, [r.id]: e instanceof Error ? e.message : "נכשל" }));
    } finally {
      setSendingId(null);
      setConfirmId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-4 py-3 border-b border-[var(--border)] flex items-center gap-2">
          <h2 className="font-semibold font-display text-base">💳 תזכורת פיקדון</h2>
          <span className="text-xs text-[var(--muted)]">{rows.length} ממתינים</span>
          <button onClick={onClose} className="mr-auto text-[var(--muted)] hover:text-[var(--text)] rounded-lg px-2 py-1 border border-[var(--border)] text-sm">
            ✕
          </button>
        </header>

        <div className="px-4 pt-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חיפוש שם או טלפון…"
            aria-label="חיפוש הזמנה"
            className="w-full bg-[var(--panel2)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />
          {noLinks && (
            <div className="mt-2 text-[11px] text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-1.5">
              אין עדיין קישורי פיקדון בנתונים - צריך להפעיל מחדש את הסוכן המקומי (node agent.js) כדי לשלוח.
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 pt-3 space-y-3">
          {!loaded ? (
            <div className="text-sm text-[var(--muted)] text-center py-6">טוען…</div>
          ) : err ? (
            <div className="text-sm text-red-400 py-2">⚠ {err}</div>
          ) : groups.length === 0 ? (
            <div className="text-sm text-[var(--muted)] text-center py-8">
              {query ? "אין תוצאות לחיפוש" : "אין הזמנות שממתינות לפיקדון 🎉"}
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.day} className="space-y-1.5">
                <div className="text-[11px] font-semibold text-[var(--muted)] px-1">{dayLabel(g.day)}</div>
                <div className="rounded-xl border border-[var(--border)] overflow-hidden divide-y divide-[var(--border)]">
                  {g.items.map((r) => {
                    const state = sent[r.id];
                    const isConfirming = confirmId === r.id;
                    return (
                      <div key={r.id} className="px-3 py-2.5 text-sm">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{r.name || "(ללא שם)"}</div>
                            <div className="text-xs text-[var(--muted)]" style={{ fontVariantNumeric: "tabular-nums" }}>
                              {r.time} · {r.seats} סועדים · <a href={`tel:${r.phone}`} dir="ltr" className="text-[var(--accent)] underline">{fmtPhone(r.phone)}</a>
                            </div>
                          </div>
                          {state === "ok" ? (
                            <span className="text-xs text-emerald-400 font-semibold shrink-0">נשלח ✓</span>
                          ) : isConfirming ? (
                            <div className="flex gap-1 shrink-0">
                              <button
                                onClick={() => send(r)}
                                disabled={sendingId === r.id}
                                className="text-xs font-semibold rounded-lg px-2.5 py-1 bg-[var(--accent)] text-[var(--accent-fg)] disabled:opacity-50"
                              >
                                {sendingId === r.id ? "שולח…" : "כן, שלח"}
                              </button>
                              <button
                                onClick={() => setConfirmId(null)}
                                className="text-xs rounded-lg px-2 py-1 border border-[var(--border)] text-[var(--muted)]"
                              >
                                לא
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmId(r.id)}
                              disabled={!r.depositLink}
                              title={r.depositLink ? "שלח תזכורת פיקדון" : "אין קישור פיקדון (הפעל מחדש את הסוכן)"}
                              className="text-xs rounded-lg px-2.5 py-1 border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-40 shrink-0"
                            >
                              💳 שלח
                            </button>
                          )}
                        </div>
                        {typeof state === "string" && state !== "ok" && (
                          <div className="text-[11px] text-red-400 mt-1">⚠ {state}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
