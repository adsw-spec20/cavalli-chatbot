"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, CHANNELS, relTime, type Reservation } from "./types";
import { SectionCard } from "./ui";

/** תבניות ההודעה שנשלחות ללקוח - ניתנות לעריכה לפני שליחה.
 *  חשוב (הוחלט 20.8): "יש מקום" עדיין לא אישור סופי - ההזמנה מאושרת רק אחרי
 *  תשלום פיקדון 100 ש"ח בקישור הטאביט שהצוות שולח. אסור לנסח "אושרה". */

/** התאריך בתבנית: קנוני מ-dateISO ("יום חמישי 13.8") כשקיים, אחרת מילות הלקוח.
 *  כך התאריך בהודעת הצוות תמיד אחיד - גם אם המודל ניסח את dateText לא עקבי
 *  (ב-12.8 נשלחו ללקוח שתי גרסאות של אותה תשובה עם שני תאריכים שונים). */
function templateDate(r: Reservation): string {
  if (r.dateISO && /^\d{4}-\d{2}-\d{2}$/.test(r.dateISO)) {
    const [y, m, d] = r.dateISO.split("-").map(Number);
    return `יום ${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d}.${m}`;
  }
  return r.dateText;
}
function approveTemplate(r: Reservation): string {
  return `חדשות טובות - יש לנו מקום ל-${templateDate(r)} בשעה ${r.time} 🙂 ${r.people} אנשים, על שם ${r.name}. כדי להשלים את ההזמנה נשלח לך עוד רגע קישור טאביט עם הפרטים - שם משלמים פיקדון של 100 ש"ח, וברגע שהוא שולם ההזמנה מאושרת סופית. מחכים לך בקפה קוואלי! 🥂`;
}
function declineTemplate(r: Reservation): string {
  return `היי ${r.name} 🙏 בדקנו ולצערנו אין לנו מקום פנוי ל-${templateDate(r)} בשעה ${r.time}. אפשר לנסות שעה או יום אחרים, או להתקשר אלינו ל-*8149 ונשמח לעזור למצוא פתרון.`;
}

/** מספר ישראלי -> קישור וואטסאפ (wa.me), או null אם לא ניתן לזהות */
function waLink(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("972") && digits.length >= 11) return `https://wa.me/${digits}`;
  if (digits.startsWith("0") && digits.length >= 9) return `https://wa.me/972${digits.slice(1)}`;
  return null;
}

const WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

/** תאריך היום בישראל בפורמט YYYY-MM-DD (לחישובי "היום"/"מחר" בצד הלקוח) */
function todayIL(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

/** "2026-07-30" -> "יום חמישי · 30.7" עם קידומת היום/מחר כשרלוונטי */
function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const base = `יום ${wd} · ${d}.${m}`;
  const today = todayIL();
  const tomorrow = new Date(new Date(today + "T12:00:00Z").getTime() + 86400000)
    .toISOString()
    .slice(0, 10);
  if (iso === today) return `היום · ${base}`;
  if (iso === tomorrow) return `מחר · ${base}`;
  return base;
}

/** שם היום בשבוע לתאריך ISO (לצ'יפ שליד תאריך חופשי) */
function weekdayOf(iso?: string): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

const STATUS_CHIP: Record<string, { label: string; cls: string }> = {
  approved: { label: "נמצא מקום", cls: "bg-emerald-500/15 text-emerald-400" },
  declined: { label: "אין מקום", cls: "bg-red-500/15 text-red-400" },
};

/** צ'יפ מידע קטן בתוך כרטיס */
function Chip({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 bg-[var(--panel)] border border-[var(--border)] rounded-lg px-2 py-1 text-xs">
      <span aria-hidden>{icon}</span>
      {children}
    </span>
  );
}

/** טלפון: חיוג + וואטסאפ ללקוח */
function PhoneActions({ phone }: { phone: string }) {
  const wa = waLink(phone);
  return (
    <span className="inline-flex items-center gap-1.5">
      <a href={`tel:${phone}`} dir="ltr" className="text-[var(--accent)] underline text-sm">
        {phone}
      </a>
      {wa && (
        <a
          href={wa}
          target="_blank"
          rel="noopener noreferrer"
          title="פתח וואטסאפ ללקוח"
          className="text-[10px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 rounded-full px-2 py-0.5"
        >
          וואטסאפ
        </a>
      )}
    </span>
  );
}

export default function Reservations({
  token,
  agentName,
  onOpenConversation,
}: {
  token: string;
  agentName: string;
  onOpenConversation: (conversationId: string) => void;
}) {
  const [pending, setPending] = useState<Reservation[]>([]);
  const [upcoming, setUpcoming] = useState<Reservation[]>([]);
  const [handled, setHandled] = useState<Reservation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState("");
  const [query, setQuery] = useState("");
  // מצב עריכת הודעה: לאיזה כרטיס, איזו פעולה, ומה הטקסט
  const [composing, setComposing] = useState<{ id: string; action: "approve" | "decline"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await api<{ pending: Reservation[]; upcoming?: Reservation[]; handled: Reservation[] }>(
        token,
        "/reservations"
      );
      setPending(d.pending);
      setUpcoming(d.upcoming ?? []);
      setHandled(d.handled);
      setLoaded(true);
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "טעינה נכשלה");
    }
  }, [token]);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  async function submit() {
    if (!composing || !composing.text.trim()) return;
    setBusy(composing.id);
    try {
      const res = await api<{ updated: Reservation; warning?: string }>(token, "/reservations", {
        method: "POST",
        body: JSON.stringify({
          id: composing.id,
          action: composing.action,
          message: composing.text.trim(),
          agentName,
        }),
      });
      setNotice(res.warning ? `⚠ ${res.warning}` : "הלקוח קיבל את התשובה בצ'אט ✓");
      setTimeout(() => setNotice(""), 5000);
      setComposing(null);
      await load();
    } catch (e) {
      setNotice(`⚠ ${e instanceof Error ? e.message : "הפעולה נכשלה"}`);
    } finally {
      setBusy(null);
    }
  }

  /** עדכון סטטוס בלבד, בלי לשלוח שום הודעה ללקוח (למשל כשסגרתם מולו בטלפון) */
  async function submitSilent() {
    if (!composing) return;
    setBusy(composing.id);
    try {
      await api(token, "/reservations", {
        method: "POST",
        body: JSON.stringify({ id: composing.id, action: composing.action, silent: true, agentName }),
      });
      setNotice("הסטטוס עודכן - לא נשלחה הודעה ללקוח ✓");
      setTimeout(() => setNotice(""), 5000);
      setComposing(null);
      await load();
    } catch (e) {
      setNotice(`⚠ ${e instanceof Error ? e.message : "הפעולה נכשלה"}`);
    } finally {
      setBusy(null);
    }
  }

  /** חיפוש חופשי על שם/טלפון/תאריך/הערות */
  const match = useCallback(
    (r: Reservation) => {
      const q = query.trim();
      if (!q) return true;
      return [r.name, r.phone, r.dateText, r.dateISO, r.time, r.notes, r.customerName]
        .filter(Boolean)
        .some((v) => String(v).includes(q));
    },
    [query]
  );

  // ממתינות: הוותיקה ביותר קודם - מי שמחכה הכי הרבה מקבל מענה ראשון
  const pendingView = useMemo(
    () => [...pending].filter(match).sort((a, b) => a.createdAt - b.createdAt),
    [pending, match]
  );
  const upcomingView = useMemo(() => upcoming.filter(match), [upcoming, match]);
  const handledView = useMemo(() => handled.filter(match), [handled, match]);

  /** אג'נדה: קיבוץ ההזמנות הקרובות לפי תאריך */
  const agenda = useMemo(() => {
    const groups = new Map<string, Reservation[]>();
    for (const r of upcomingView) {
      const key = r.dateISO ?? "";
      const arr = groups.get(key);
      if (arr) arr.push(r);
      else groups.set(key, [r]);
    }
    return [...groups.entries()];
  }, [upcomingView]);

  const handledToday = useMemo(() => {
    const start = new Date(todayIL() + "T00:00:00+03:00").getTime();
    return handled.filter((r) => (r.handledAt ?? 0) >= start).length;
  }, [handled]);

  return (
    <div className="space-y-5 max-w-[1700px]">
      {notice && (
        <div className="bg-[var(--panel)] border border-[var(--accent)]/40 rounded-xl px-3 py-2 text-sm">{notice}</div>
      )}

      {/* ===== כותרת + מדדים ===== */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-[var(--panel)] border border-amber-500/30 rounded-2xl p-3 text-center">
          <div className="text-2xl font-bold text-amber-300 font-display" style={{ fontVariantNumeric: "tabular-nums" }}>
            {pending.length}
          </div>
          <div className="text-[11px] text-[var(--muted)]">ממתינות לתשובה</div>
        </div>
        <div className="bg-[var(--panel)] border border-emerald-500/25 rounded-2xl p-3 text-center">
          <div className="text-2xl font-bold text-emerald-400 font-display" style={{ fontVariantNumeric: "tabular-nums" }}>
            {upcoming.length}
          </div>
          <div className="text-[11px] text-[var(--muted)]">מאושרות קרובות</div>
        </div>
        <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-3 text-center">
          <div className="text-2xl font-bold font-display" style={{ fontVariantNumeric: "tabular-nums" }}>
            {handledToday}
          </div>
          <div className="text-[11px] text-[var(--muted)]">טופלו היום</div>
        </div>
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="חיפוש לפי שם, טלפון או תאריך…"
        aria-label="חיפוש הזמנות"
        className="w-full bg-[var(--panel)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
      />

      {!loaded && <div className="text-sm text-[var(--muted)] p-4">טוען…</div>}
      {loaded && err && <div className="text-sm text-red-400 p-2">⚠ {err}</div>}

      {/* בדסקטופ: הממתינות מימין, האג'נדה וההיסטוריה משמאל */}
      <div className="grid xl:grid-cols-2 gap-5 items-start">

      {/* ===== בקשות ממתינות ===== */}
      {loaded && !err && (
        <SectionCard
          title="בקשות ממתינות"
          badge={pendingView.length}
          badgeCls="bg-amber-500/15 text-amber-300"
          sub="בדקו מקום ביומן/טאביט ואשרו או דחו - הלקוח מקבל את התשובה ישירות בצ'אט. הוותיקה ביותר מוצגת ראשונה."
        >
          {pendingView.length === 0 && (
            <div className="p-4 text-center text-sm text-[var(--muted)]">
              {query ? "אין תוצאות לחיפוש בממתינות" : "אין בקשות ממתינות 🎉"}
            </div>
          )}
          <div className="space-y-2.5">
            {pendingView.map((r) => {
              const wd = weekdayOf(r.dateISO);
              return (
                <div key={r.id} className="bg-[var(--panel2)] border border-amber-500/25 rounded-xl p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Chip icon="👥">{r.people} סועדים</Chip>
                        <Chip icon="📅">
                          {r.dateText}
                          {wd && !r.dateText.includes(wd) ? ` (${wd})` : ""}
                        </Chip>
                        <Chip icon="🕐">{r.time}</Chip>
                      </div>
                      <div className="text-sm mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                        על שם <b>{r.name}</b> · <PhoneActions phone={r.phone} />
                      </div>
                      {r.notes && (
                        <div className="text-xs mt-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-1.5">
                          💬 {r.notes}
                        </div>
                      )}
                    </div>
                    <div className="text-left shrink-0">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${CHANNELS[r.channel]?.chip ?? ""}`}>
                        {CHANNELS[r.channel]?.label ?? r.channel}
                      </span>
                      <div className="text-[10px] text-[var(--muted)] mt-1">התקבלה {relTime(r.createdAt)}</div>
                      {r.dateISO && <div className="text-[10px] text-[var(--muted)] mt-0.5">{r.dateISO}</div>}
                    </div>
                  </div>

                  {composing?.id === r.id ? (
                    <div className="mt-3 space-y-2">
                      <div className="text-xs text-[var(--muted)]">
                        {composing.action === "approve"
                          ? "הודעת האישור שתישלח ללקוח (אפשר לערוך):"
                          : "הודעת הדחייה שתישלח ללקוח (אפשר לערוך):"}
                      </div>
                      <textarea
                        value={composing.text}
                        onChange={(e) => setComposing({ ...composing, text: e.target.value })}
                        rows={3}
                        className="w-full bg-[var(--panel)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={submit}
                          disabled={busy === r.id}
                          className={`text-xs font-semibold rounded-lg px-3 py-1.5 disabled:opacity-40 ${
                            composing.action === "approve"
                              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                              : "bg-red-500/15 text-red-400 border border-red-500/40"
                          }`}
                        >
                          {busy === r.id ? "שולח…" : composing.action === "approve" ? "✓ אשר ושלח ללקוח" : "שלח ללקוח"}
                        </button>
                        <button
                          onClick={submitSilent}
                          disabled={busy === r.id}
                          className="text-xs border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] rounded-lg px-3 py-1.5"
                          title="עדכון הסטטוס בלבד - הלקוח לא יקבל שום הודעה"
                        >
                          {composing.action === "approve" ? "אשר בלי הודעה" : "דחה בלי הודעה"}
                        </button>
                        <button onClick={() => setComposing(null)} className="text-xs text-[var(--muted)] px-2">
                          ביטול
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2 mt-3 flex-wrap">
                      <button
                        onClick={() => setComposing({ id: r.id, action: "approve", text: approveTemplate(r) })}
                        className="text-xs bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-semibold rounded-lg px-3 py-1.5"
                      >
                        ✓ אשר
                      </button>
                      <button
                        onClick={() => setComposing({ id: r.id, action: "decline", text: declineTemplate(r) })}
                        className="text-xs bg-red-500/15 text-red-400 border border-red-500/40 font-semibold rounded-lg px-3 py-1.5"
                      >
                        אין מקום
                      </button>
                      <button
                        onClick={() => onOpenConversation(r.conversationId)}
                        className="text-xs text-[var(--muted)] hover:text-[var(--text)] underline px-1"
                      >
                        לשיחה המלאה
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      <div className="space-y-5">
      {/* ===== אג'נדה: הזמנות מאושרות קרובות ===== */}
      {loaded && !err && (
        <SectionCard
          title="הזמנות קרובות"
          badge={upcomingView.length}
          badgeCls="bg-emerald-500/15 text-emerald-400"
          sub="מה מחכה לנו - הזמנות שאושרו, מסודרות לפי יום ושעה."
        >
          {upcomingView.length === 0 ? (
            <div className="p-4 text-center text-sm text-[var(--muted)]">
              {query ? "אין תוצאות לחיפוש בקרובות" : "אין הזמנות מאושרות קרובות"}
            </div>
          ) : (
            <div className="space-y-3">
              {agenda.map(([iso, items]) => (
                <div key={iso || "no-date"} className="border border-[var(--border)] rounded-xl overflow-hidden">
                  <div className="px-3 py-2 text-xs font-semibold border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]">
                    {iso ? dayLabel(iso) : "בלי תאריך מזוהה"}
                  </div>
                  <div className="divide-y divide-[var(--border)]">
                    {items.map((r) => (
                      <div key={r.id} className="px-3 py-2 flex items-center justify-between gap-2 flex-wrap text-sm">
                        <span className="flex items-center gap-2 min-w-0">
                          <b style={{ fontVariantNumeric: "tabular-nums" }}>{r.time}</b>
                          <span className="truncate">
                            {r.name} · {r.people} אנשים
                          </span>
                          {r.notes && (
                            <span className="text-[var(--muted)] text-xs truncate" title={r.notes}>
                              💬 {r.notes.slice(0, 30)}
                            </span>
                          )}
                        </span>
                        <span className="flex items-center gap-2 shrink-0">
                          <PhoneActions phone={r.phone} />
                          <button
                            onClick={() => onOpenConversation(r.conversationId)}
                            className="text-xs text-[var(--muted)] hover:text-[var(--text)] underline"
                          >
                            לשיחה
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {/* ===== טופלו לאחרונה ===== */}
      {loaded && !err && handledView.length > 0 && (
        <SectionCard title="טופלו לאחרונה" badge={handledView.length}>
          <div className="space-y-1.5">
            {handledView.map((r) => (
              <div
                key={r.id}
                className="bg-[var(--panel2)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm flex items-center justify-between gap-2 flex-wrap"
              >
                <button
                  onClick={() => onOpenConversation(r.conversationId)}
                  className="text-right hover:underline min-w-0 truncate"
                  title="פתח את השיחה"
                >
                  {r.name} · {r.people} אנשים · {r.dateText} {r.time}
                </button>
                <span className="flex items-center gap-2 text-xs shrink-0">
                  <span className={`px-2 py-0.5 rounded-full ${STATUS_CHIP[r.status]?.cls ?? ""}`}>
                    {STATUS_CHIP[r.status]?.label ?? r.status}
                  </span>
                  <span className="text-[var(--muted)]">
                    {r.handledBy ? `ע"י ${r.handledBy} · ` : ""}
                    {r.handledAt ? relTime(r.handledAt) : ""}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
      </div>
      </div>
    </div>
  );
}
