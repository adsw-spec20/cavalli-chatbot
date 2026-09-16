"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type Reservation } from "./types";
import { approveTemplate, declineTemplate, templateDate } from "./reservation-templates";

/**
 * כרטיס בקשת הזמנה בתוך שיחת התיבה (16.9): כשללקוח של השיחה הפתוחה יש
 * בקשת הזמנה שממתינה לתשובה, הצוות עונה לה ישר מכאן - בלי לצאת לעמוד
 * ההזמנות. אותו API ואותה התנהגות בדיוק כמו שם: תבנית ניתנת לעריכה,
 * אפשרות "בלי הודעה", ושער קישור התשלום לפני אישור.
 */

export default function ConversationReservation({
  token,
  agentName,
  conversationId,
  onDone,
}: {
  token: string;
  agentName: string;
  conversationId: string;
  onDone: () => void;
}) {
  const [resv, setResv] = useState<Reservation | null>(null);
  const [composing, setComposing] = useState<{ action: "approve" | "decline"; text: string } | null>(null);
  const [linkGate, setLinkGate] = useState<"send" | "silent" | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await api<{ pending: Reservation[] }>(token, "/reservations");
      const mine = (d.pending || [])
        .filter((r) => r.conversationId === conversationId)
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      setResv(mine ?? null);
    } catch {
      /* לא חוסמים את השיחה בגלל הכרטיס */
    }
  }, [token, conversationId]);

  useEffect(() => {
    setComposing(null);
    setNotice("");
    load();
  }, [load]);

  async function submit(silent: boolean) {
    if (!resv || !composing || busy) return;
    if (!silent && !composing.text.trim()) return;
    setBusy(true);
    try {
      const body = silent
        ? { id: resv.id, action: composing.action, silent: true, agentName }
        : { id: resv.id, action: composing.action, message: composing.text.trim(), agentName };
      const res = await api<{ warning?: string }>(token, "/reservations", { method: "POST", body: JSON.stringify(body) });
      setNotice(
        res?.warning
          ? `⚠ ${res.warning}`
          : silent
            ? "הסטטוס עודכן - לא נשלחה הודעה ללקוח ✓"
            : "הלקוח קיבל את התשובה בצ'אט ✓"
      );
      setResv(null);
      setComposing(null);
      onDone(); // מרענן את הרשימה - הדגל יורד והנעיצה מתבטלת
      setTimeout(() => setNotice(""), 6000);
    } catch (e) {
      setNotice(`⚠ ${e instanceof Error ? e.message : "הפעולה נכשלה"}`);
    } finally {
      setBusy(false);
      setLinkGate(null);
    }
  }

  /** אישור עובר קודם בשער קישור התשלום (כמו בעמוד ההזמנות) */
  function primary() {
    if (!composing) return;
    if (composing.action === "approve") return setLinkGate("send");
    submit(false);
  }
  function silentAction() {
    if (!composing) return;
    if (composing.action === "approve") return setLinkGate("silent");
    submit(true);
  }

  if (!resv) {
    return notice ? (
      <div className="mx-3 mt-2 shrink-0 text-xs bg-emerald-500/10 border border-emerald-500/25 rounded-xl p-2.5 text-emerald-500">{notice}</div>
    ) : null;
  }

  return (
    <div className="mx-3 mt-2 shrink-0 text-sm bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-amber-600">🍽️ בקשת הזמנה ממתינה</span>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {templateDate(resv)} · {resv.time} · {resv.people} סועדים · ע"ש {resv.name}
        </span>
        {resv.phone && (
          <a href={`tel:${resv.phone}`} dir="ltr" className="text-[var(--accent)] underline text-xs">
            {resv.phone}
          </a>
        )}
      </div>
      {resv.notes && <div className="text-xs text-[var(--muted)]">💬 {resv.notes}</div>}

      {!composing ? (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setComposing({ action: "approve", text: approveTemplate(resv) })}
            className="text-xs font-semibold rounded-lg px-3 py-1.5 bg-emerald-500/20 text-emerald-600 border border-emerald-500/40"
          >
            ✓ יש מקום
          </button>
          <button
            onClick={() => setComposing({ action: "decline", text: declineTemplate(resv) })}
            className="text-xs font-semibold rounded-lg px-3 py-1.5 bg-red-500/15 text-red-500 border border-red-500/40"
          >
            אין מקום
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-xs text-[var(--muted)]">
            {composing.action === "approve" ? "הודעת האישור שתישלח ללקוח (אפשר לערוך):" : "הודעת הדחייה שתישלח ללקוח (אפשר לערוך):"}
          </div>
          <textarea
            value={composing.text}
            onChange={(e) => setComposing({ ...composing, text: e.target.value })}
            rows={3}
            className="w-full bg-[var(--panel)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={primary}
              disabled={busy}
              className={`text-xs font-semibold rounded-lg px-3 py-1.5 disabled:opacity-40 ${
                composing.action === "approve"
                  ? "bg-emerald-500/20 text-emerald-600 border border-emerald-500/40"
                  : "bg-red-500/15 text-red-500 border border-red-500/40"
              }`}
            >
              {busy ? "שולח…" : composing.action === "approve" ? "✓ אשר ושלח ללקוח" : "שלח ללקוח"}
            </button>
            <button
              onClick={silentAction}
              disabled={busy}
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
      )}
      {notice && <div className="text-xs">{notice}</div>}

      {/* שער קישור התשלום: האישור יוצא רק אחרי "שלחתי" (כמו בעמוד ההזמנות) */}
      {linkGate && (
        <div className="fixed inset-0 z-50 bg-black/50 grid place-items-center p-4" role="dialog" aria-modal="true">
          <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-5 max-w-xs w-full space-y-4 shadow-2xl">
            <h3 className="font-semibold text-base font-display text-center">שלחת ללקוח את קישור התשלום?</h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => submit(linkGate === "silent")}
                className="text-sm bg-[var(--accent)] text-[var(--accent-fg)] font-semibold rounded-xl py-2.5"
              >
                שלחתי
              </button>
              <button onClick={() => setLinkGate(null)} className="text-sm border border-[var(--border)] rounded-xl py-2.5 hover:bg-[var(--panel2)]">
                לא שלחתי
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
