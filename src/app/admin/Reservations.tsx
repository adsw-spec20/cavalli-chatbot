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
  return `חדשות טובות - יש לנו מקום ל-${templateDate(r)} בשעה ${r.time} 🙂 ${r.people} אנשים, על שם ${r.name}. כדי להשלים את ההזמנה נשלח לך עוד רגע קישור לתשלום עם הפרטים - שם משלמים פיקדון של 100 ש"ח, וברגע שהוא שולם ההזמנה מאושרת סופית. מחכים לך בקפה קוואלי! 🥂`;
}
function declineTemplate(r: Reservation): string {
  return `היי ${r.name} 🙏 בדקנו ולצערנו אין לנו מקום פנוי ל-${templateDate(r)} בשעה ${r.time}. אפשר לנסות שעה או יום אחרים, או לחייג *8149 או 050-979-8917 ונשמח לעזור למצוא פתרון.`;
}
function cancelTemplate(r: Reservation): string {
  return `היי ${r.name} 🙏 ההזמנה שלך ל-${templateDate(r)} בשעה ${r.time} (${r.people} אנשים) בוטלה. אם מדובר בטעות או שתרצה לקבוע מחדש, אפשר לחייג *8149 או 050-979-8917 ונשמח לעזור.`;
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
  cancelled: { label: "בוטלה", cls: "bg-neutral-500/15 text-neutral-400" },
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

/** תיבת עריכת ההודעה ללקוח (אישור / דחייה / ביטול) - משותפת לבקשות הממתינות ולהזמנות הקרובות. */
function ComposeBox({
  composing,
  setComposing,
  onSubmit,
  onSubmitSilent,
  busy,
}: {
  composing: { id: string; action: "approve" | "decline" | "cancel"; text: string };
  setComposing: (c: { id: string; action: "approve" | "decline" | "cancel"; text: string } | null) => void;
  onSubmit: () => void;
  onSubmitSilent: () => void;
  busy: boolean;
}) {
  const a = composing.action;
  const header =
    a === "approve"
      ? "הודעת האישור שתישלח ללקוח (אפשר לערוך):"
      : a === "cancel"
        ? "הודעת הביטול שתישלח ללקוח (אפשר לערוך):"
        : "הודעת הדחייה שתישלח ללקוח (אפשר לערוך):";
  const primaryLabel = busy
    ? "שולח…"
    : a === "approve"
      ? "✓ אשר ושלח ללקוח"
      : a === "cancel"
        ? "בטל ושלח ללקוח"
        : "שלח ללקוח";
  const silentLabel = a === "approve" ? "אשר בלי הודעה" : a === "cancel" ? "בטל בלי הודעה" : "דחה בלי הודעה";
  const primaryCls =
    a === "approve"
      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
      : "bg-red-500/15 text-red-400 border border-red-500/40";
  return (
    <div className="mt-3 space-y-2">
      <div className="text-xs text-[var(--muted)]">{header}</div>
      <textarea
        value={composing.text}
        onChange={(e) => setComposing({ ...composing, text: e.target.value })}
        rows={3}
        className="w-full bg-[var(--panel)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
      />
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={onSubmit}
          disabled={busy}
          className={`text-xs font-semibold rounded-lg px-3 py-1.5 disabled:opacity-40 ${primaryCls}`}
        >
          {primaryLabel}
        </button>
        <button
          onClick={onSubmitSilent}
          disabled={busy}
          className="text-xs border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] rounded-lg px-3 py-1.5"
          title="עדכון הסטטוס בלבד - הלקוח לא יקבל שום הודעה"
        >
          {silentLabel}
        </button>
        <button onClick={() => setComposing(null)} className="text-xs text-[var(--muted)] px-2">
          סגור
        </button>
      </div>
    </div>
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
  // תצוגה נבחרת: ממתינות / קרובות / היסטוריה (במקום שלוש סקציות מוערמות)
  const [view, setView] = useState<"pending" | "upcoming" | "handled">("pending");
  const [showSearch, setShowSearch] = useState(false);
  // שער לפני אישור: המארחות אישרו ושכחו לשלוח את קישור התשלום (דווח 31.8),
  // והלקוח נשאר מחכה להודעה שהובטחה לו. ההודעה יוצאת רק אחרי "שלחתי";
  // "לא שלחתי" משאיר את ההזמנה ממתינה כדי שהיא לא תיפול בין הכיסאות.
  // הערך מציין לאיזו פעולה השער נפתח (עם הודעה / בלי).
  const [linkGate, setLinkGate] = useState<"send" | "silent" | null>(null);
  // מצב עריכת הודעה: לאיזה כרטיס, איזו פעולה, ומה הטקסט
  const [composing, setComposing] = useState<{
    id: string;
    action: "approve" | "decline" | "cancel";
    text: string;
  } | null>(null);
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

  // submit/submitSilent מחוברים ישירות ל-onClick, כך שהן מקבלות את אירוע
  // הלחיצה כארגומנט - לכן השער הוא פונקציה נפרדת ולא פרמטר עם ברירת מחדל.
  function submit() {
    if (!composing || !composing.text.trim()) return;
    if (composing.action === "approve") return setLinkGate("send");
    doSubmit();
  }

  function submitSilent() {
    if (!composing) return;
    if (composing.action === "approve") return setLinkGate("silent");
    doSubmitSilent();
  }

  async function doSubmit() {
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
  async function doSubmitSilent() {
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

  const views = [
    { key: "pending" as const, label: "ממתינות", n: pendingView.length, cls: "bg-amber-500/15 text-amber-500 border-amber-500/40" },
    { key: "upcoming" as const, label: "קרובות", n: upcomingView.length, cls: "bg-emerald-500/15 text-emerald-500 border-emerald-500/40" },
    { key: "handled" as const, label: "היסטוריה", n: handledView.length, cls: "bg-[var(--panel2)] text-[var(--muted)] border-[var(--border)]" },
  ];

  return (
    <div className="space-y-3 max-w-[900px]">
      {notice && (
        <div className="bg-[var(--panel)] border border-[var(--accent)]/40 rounded-xl px-3 py-2 text-sm">{notice}</div>
      )}

      {/* מתג תצוגה + חיפוש מתקפל: שורה אחת במקום שלושה אריחים ותיבת חיפוש קבועה */}
      <div className="flex gap-1.5 items-center">
        {views.map((v) => {
          const on = view === v.key;
          return (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              aria-current={on ? "page" : undefined}
              className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-sm border transition ${
                on ? "bg-[var(--accent)] text-[var(--accent-fg)] border-transparent font-semibold" : `${v.cls} hover:opacity-80`
              }`}
            >
              {v.label}
              <span
                className={`text-[11px] font-bold rounded-full px-1.5 ${on ? "bg-[var(--accent-fg)]/20" : "bg-[var(--panel)]/60"}`}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {v.n}
              </span>
            </button>
          );
        })}
        <button
          onClick={() => setShowSearch((x) => !x)}
          aria-label="חיפוש הזמנות"
          className={`shrink-0 w-11 h-11 grid place-items-center rounded-xl border transition ${
            showSearch || query ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--border)] text-[var(--muted)]"
          }`}
        >
          🔍
        </button>
      </div>
      {(showSearch || query) && (
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="חיפוש לפי שם, טלפון או תאריך…"
          aria-label="חיפוש הזמנות"
          className="w-full bg-[var(--panel)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
        />
      )}

      {!loaded && <div className="text-sm text-[var(--muted)] p-4">טוען…</div>}
      {loaded && err && <div className="text-sm text-red-400 p-2">⚠ {err}</div>}

      {/* ===== ממתינות ===== */}
      {loaded && !err && view === "pending" && (
        <div className="space-y-2.5">
          <p className="text-xs text-[var(--muted)] px-0.5">
            בדקו מקום ביומן/טאביט ואשרו או דחו - הלקוח מקבל את התשובה ישירות בצ&apos;אט. הוותיקה ביותר ראשונה.
          </p>
          {pendingView.length === 0 && (
            <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-8 text-center text-sm text-[var(--muted)]">
              {query ? "אין תוצאות לחיפוש" : "אין בקשות ממתינות 🎉"}
            </div>
          )}
          {pendingView.map((r) => {
            const wd = weekdayOf(r.dateISO);
            const dateLabel = r.dateText + (wd && !r.dateText.includes(wd) ? ` (${wd})` : "");
            return (
              <div key={r.id} className="bg-[var(--panel)] border border-amber-500/30 rounded-2xl p-3.5 space-y-2.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-[15px] font-display" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {r.people} סועדים · {dateLabel} · {r.time}
                  </span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full mr-auto shrink-0 ${CHANNELS[r.channel]?.chip ?? ""}`}>
                    {CHANNELS[r.channel]?.label ?? r.channel}
                  </span>
                </div>

                <div className="text-sm flex flex-wrap items-center gap-x-2 gap-y-1">
                  <b>{r.name}</b>
                  <PhoneActions phone={r.phone} />
                  <span className="text-[11px] text-[var(--muted)] mr-auto">התקבלה {relTime(r.createdAt)}</span>
                </div>

                {r.notes && (
                  <div className="text-xs bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-1.5">💬 {r.notes}</div>
                )}

                {composing?.id === r.id ? (
                  <ComposeBox
                    composing={composing}
                    setComposing={setComposing}
                    onSubmit={submit}
                    onSubmitSilent={submitSilent}
                    busy={busy === r.id}
                  />
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => setComposing({ id: r.id, action: "approve", text: approveTemplate(r) })}
                      className="text-sm bg-emerald-500/20 text-emerald-500 border border-emerald-500/40 font-semibold rounded-xl py-2.5"
                    >
                      ✓ יש מקום
                    </button>
                    <button
                      onClick={() => setComposing({ id: r.id, action: "decline", text: declineTemplate(r) })}
                      className="text-sm bg-red-500/15 text-red-400 border border-red-500/40 font-semibold rounded-xl py-2.5"
                    >
                      אין מקום
                    </button>
                    <button
                      onClick={() => onOpenConversation(r.conversationId)}
                      className="text-sm text-[var(--muted)] border border-[var(--border)] rounded-xl py-2.5 hover:text-[var(--text)]"
                    >
                      השיחה
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ===== קרובות (אג'נדה) ===== */}
      {loaded && !err && view === "upcoming" && (
        <div className="space-y-2.5">
          <p className="text-xs text-[var(--muted)] px-0.5">מה מחכה לנו - הזמנות שאושרו, מסודרות לפי יום ושעה.</p>
          {upcomingView.length === 0 ? (
            <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-8 text-center text-sm text-[var(--muted)]">
              {query ? "אין תוצאות לחיפוש" : "אין הזמנות מאושרות קרובות"}
            </div>
          ) : (
            agenda.map(([iso, items]) => (
              <div key={iso || "no-date"} className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl overflow-hidden">
                <div className="px-3.5 py-2 text-xs font-semibold border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]">
                  {iso ? dayLabel(iso) : "בלי תאריך מזוהה"}
                </div>
                <div className="divide-y divide-[var(--border)]">
                  {items.map((r) => (
                    <div key={r.id} className="px-3.5 py-2.5 text-sm space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <b className="font-display" style={{ fontVariantNumeric: "tabular-nums" }}>
                          {r.time}
                        </b>
                        <span className="truncate">
                          {r.name} · {r.people} אנשים
                        </span>
                        {r.notes && (
                          <span className="text-[var(--muted)] text-xs truncate" title={r.notes}>
                            💬 {r.notes.slice(0, 30)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <PhoneActions phone={r.phone} />
                        <button
                          onClick={() => onOpenConversation(r.conversationId)}
                          className="text-xs text-[var(--muted)] hover:text-[var(--text)] underline"
                        >
                          השיחה
                        </button>
                        {composing?.id !== r.id && (
                          <button
                            onClick={() => setComposing({ id: r.id, action: "cancel", text: cancelTemplate(r) })}
                            className="text-xs bg-red-500/10 text-red-400 border border-red-500/30 rounded-lg px-2 py-1 mr-auto"
                            title="ביטול ההזמנה המאושרת"
                          >
                            בטל הזמנה
                          </button>
                        )}
                      </div>
                      {composing?.id === r.id && (
                        <ComposeBox
                          composing={composing}
                          setComposing={setComposing}
                          onSubmit={submit}
                          onSubmitSilent={submitSilent}
                          busy={busy === r.id}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ===== היסטוריה ===== */}
      {loaded && !err && view === "handled" && (
        <div className="space-y-1.5">
          <p className="text-xs text-[var(--muted)] px-0.5">בקשות שכבר טופלו. לחיצה פותחת את השיחה.</p>
          {handledView.length === 0 && (
            <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-8 text-center text-sm text-[var(--muted)]">
              אין היסטוריה להצגה
            </div>
          )}
          {handledView.map((r) => (
            <button
              key={r.id}
              onClick={() => onOpenConversation(r.conversationId)}
              className="w-full text-right bg-[var(--panel)] border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm flex items-center justify-between gap-2 flex-wrap hover:border-[var(--accent)]"
            >
              <span className="min-w-0 truncate">
                {r.name} · {r.people} אנשים · {r.dateText} {r.time}
              </span>
              <span className="flex items-center gap-2 text-xs shrink-0">
                <span className={`px-2 py-0.5 rounded-full ${STATUS_CHIP[r.status]?.cls ?? ""}`}>
                  {STATUS_CHIP[r.status]?.label ?? r.status}
                </span>
                <span className="text-[var(--muted)]">
                  {r.handledBy ? `ע"י ${r.handledBy} · ` : ""}
                  {r.handledAt ? relTime(r.handledAt) : ""}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {/* שער קישור התשלום: האישור יוצא רק אחרי "שלחתי" */}
      {linkGate && (
        <div
          className="fixed inset-0 z-50 bg-black/50 grid place-items-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="link-gate-title"
        >
          <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-5 max-w-xs w-full space-y-4 shadow-2xl">
            <h3 id="link-gate-title" className="font-semibold text-base font-display text-center">
              שלחת ללקוח את קישור התשלום?
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  const mode = linkGate;
                  setLinkGate(null);
                  if (mode === "send") doSubmit();
                  else doSubmitSilent();
                }}
                className="text-sm bg-[var(--accent)] text-[var(--accent-fg)] font-semibold rounded-xl py-2.5"
              >
                שלחתי
              </button>
              <button
                onClick={() => setLinkGate(null)}
                className="text-sm border border-[var(--border)] rounded-xl py-2.5 hover:bg-[var(--panel2)]"
              >
                לא שלחתי
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
