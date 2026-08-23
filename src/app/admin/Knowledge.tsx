"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type LearnedQA, type QAAsker } from "./types";
import { SectionCard } from "./ui";

/** שורת "מי שאל" - שם + תאריך, לחיץ לפתיחת השיחה */
function AskersRow({
  q,
  onOpen,
}: {
  q: LearnedQA;
  onOpen?: (conversationId: string) => void;
}) {
  const askers = q.askers ?? [];
  if (askers.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 mb-2">
      <span className="text-[10px] text-[var(--muted)]">נשאלה ע"י:</span>
      {askers.map((a, i) => (
        <button
          key={i}
          onClick={() => onOpen?.(a.conversationId)}
          title="פתיחת השיחה"
          className="text-[10px] bg-[var(--panel)] border border-[var(--border)] rounded-full px-2 py-0.5 hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          💬 {a.name || "לקוח"} · {fmtDate(a.ts)}
        </button>
      ))}
    </div>
  );
}

function fmtDate(ts?: number): string {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString("he-IL", { day: "numeric", month: "short", year: "numeric" });
}

export default function Knowledge({
  token,
  onMutate,
  onTest,
  onOpenConversation,
  agentName,
}: {
  token: string;
  onMutate?: () => void;
  onTest?: (question: string) => void;
  onOpenConversation?: (conversationId: string) => void;
  agentName?: string;
}) {
  const [sending, setSending] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<Set<string>>(new Set());

  /** "שלח ללקוח ששאל": שולח את התשובה השמורה ישירות לשיחה של השואל */
  async function sendToAsker(qaId: string, asker: QAAsker) {
    const key = qaId + ":" + asker.conversationId;
    setSending(key);
    try {
      await api(token, `/knowledge/${qaId}`, {
        method: "POST",
        body: JSON.stringify({ action: "sendToAsker", conversationId: asker.conversationId, agentName }),
      });
      setSentTo((s) => new Set(s).add(key));
    } catch (e) {
      alert(e instanceof Error ? e.message : "השליחה נכשלה");
    } finally {
      setSending(null);
    }
  }
  const [open, setOpen] = useState<LearnedQA[]>([]);
  const [answered, setAnswered] = useState<LearnedQA[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editQ, setEditQ] = useState("");
  const [editA, setEditA] = useState("");
  const [editErr, setEditErr] = useState("");
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newQ, setNewQ] = useState("");
  const [newA, setNewA] = useState("");
  const [addErr, setAddErr] = useState("");

  const load = useCallback(async () => {
    try {
      const [o, a] = await Promise.all([
        api<LearnedQA[]>(token, "/knowledge?status=open"),
        api<LearnedQA[]>(token, "/knowledge?status=answered"),
      ]);
      setOpen(o);
      setAnswered(a);
      setLoaded(true);
      setLoadErr("");
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "טעינה נכשלה");
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function answer(id: string) {
    const a = (drafts[id] ?? "").trim();
    if (!a) return;
    setBusy(id);
    try {
      await api(token, `/knowledge/${id}`, { method: "POST", body: JSON.stringify({ answer: a }) });
      setDrafts((d) => ({ ...d, [id]: "" }));
      setJustSaved(id);
      setTimeout(() => setJustSaved((j) => (j === id ? null : j)), 6000);
      await load();
      onMutate?.();
    } catch (e) {
      alert(e instanceof Error ? e.message : "שמירה נכשלה");
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string, label: string) {
    if (!confirm(label)) return;
    setBusy(id);
    try {
      await api(token, `/knowledge/${id}`, { method: "POST", body: JSON.stringify({ action: "delete" }) });
      await load();
      onMutate?.();
    } finally {
      setBusy(null);
    }
  }

  function startEdit(q: LearnedQA) {
    setEditing(q.id);
    setEditQ(q.question);
    setEditA(q.answer ?? "");
    setEditErr("");
  }

  async function saveEdit(q: LearnedQA) {
    const question = editQ.trim();
    const answerText = editA.trim();
    if (!question || (q.status === "answered" && !answerText)) {
      setEditErr("שאלה ותשובה לא יכולות להיות ריקות");
      return;
    }
    setBusy(q.id);
    setEditErr("");
    try {
      await api(token, `/knowledge/${q.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          question,
          answer: answerText || undefined,
          // הגנת דריסה: אם מישהו אחר ערך בינתיים - נקבל 409 במקום לדרוס בשקט
          baseTs: q.updatedAt ?? q.answeredAt ?? q.createdAt,
        }),
      });
      setEditing(null);
      setJustSaved(q.id);
      setTimeout(() => setJustSaved((j) => (j === q.id ? null : j)), 6000);
      await load();
      onMutate?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "שמירה נכשלה";
      setEditErr(
        msg === "conflict"
          ? "הפריט עודכן ממקום אחר בזמן שערכת. רענן את הרשימה ונסה שוב."
          : msg
      );
    } finally {
      setBusy(null);
    }
  }

  async function addNew() {
    const q = newQ.trim();
    const a = newA.trim();
    if (q.length < 2 || !a) {
      setAddErr("צריך גם שאלה וגם תשובה");
      return;
    }
    setBusy("new");
    setAddErr("");
    try {
      await api(token, "/knowledge", { method: "POST", body: JSON.stringify({ question: q, answer: a }) });
      setNewQ("");
      setNewA("");
      setAdding(false);
      await load();
      onMutate?.();
    } catch (e) {
      setAddErr(e instanceof Error ? e.message : "שמירה נכשלה");
    } finally {
      setBusy(null);
    }
  }

  const filteredAnswered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return answered;
    return answered.filter(
      (x) => x.question.toLowerCase().includes(q) || (x.answer ?? "").toLowerCase().includes(q)
    );
  }, [answered, search]);

  if (loadErr && !loaded) {
    return (
      <div className="max-w-3xl bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-6 text-center text-sm">
        <div className="text-red-400 mb-2">⚠ {loadErr}</div>
        <button onClick={load} className="text-xs underline text-[var(--accent)]">נסה שוב</button>
      </div>
    );
  }

  return (
    <div className="max-w-[1700px] grid grid-cols-1 gap-6 xl:grid-cols-2 items-start">
      {/* ===== שאלות פתוחות ===== */}
      <SectionCard
        title="שאלות שהבוט לא ידע לענות"
        badge={open.length}
        badgeCls="bg-amber-500/15 text-amber-300"
        sub="ענה כאן בשפה חופשית - המערכת תנסח את התשובה מקצועית, והבוט ילמד לענות עליה לבד מהפעם הבאה."
      >
        {!loaded && <div className="text-sm text-[var(--muted)] p-4">טוען…</div>}
        {loaded && open.length === 0 && (
          <div className="p-5 text-center text-sm text-[var(--muted)]">
            🎉 אין שאלות פתוחות. הבוט עונה על הכל בינתיים.
          </div>
        )}
        <div className="space-y-2.5">
          {open.map((q) => (
            <div key={q.id} className="bg-[var(--panel)] border border-[var(--border)] rounded-xl p-3.5">
              {editing === q.id ? (
                <input
                  value={editQ}
                  onChange={(e) => setEditQ(e.target.value)}
                  className="w-full font-medium text-sm mb-2 bg-[var(--panel)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 outline-none focus:border-[var(--accent)]"
                  aria-label="עריכת ניסוח השאלה"
                />
              ) : (
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="font-medium text-sm">❓ {q.question}</div>
                  <button onClick={() => startEdit(q)} className="text-[10px] text-[var(--muted)] hover:text-[var(--text)] underline shrink-0">
                    ערוך ניסוח
                  </button>
                </div>
              )}
              <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                {(q.count ?? 1) > 1 && (
                  <span className="text-[10px] bg-amber-500/15 text-amber-300 rounded-full px-2 py-0.5 font-semibold">
                    נשאלה {q.count} פעמים
                  </span>
                )}
                {q.topic && (
                  <span className="text-[10px] bg-[var(--accent)]/10 text-[var(--accent)] rounded-full px-2 py-0.5">
                    {q.topic}
                  </span>
                )}
                <span className="text-[10px] text-[var(--muted)]">נשאלה {fmtDate(q.createdAt)}</span>
              </div>
              <AskersRow q={q} onOpen={onOpenConversation} />
              <textarea
                value={drafts[q.id] ?? ""}
                onChange={(e) => setDrafts((d) => ({ ...d, [q.id]: e.target.value }))}
                rows={2}
                placeholder="ענה בשפה חופשית - המערכת תנסח מקצועית לפני השמירה…"
                className="w-full bg-[var(--panel)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
              />
              {editing === q.id && editErr && <div className="text-xs text-red-400 mt-1">⚠ {editErr}</div>}
              <div className="flex gap-2 mt-2 flex-wrap items-center">
                {editing === q.id ? (
                  <>
                    <button
                      onClick={() => saveEdit({ ...q })}
                      disabled={busy === q.id}
                      className="text-xs bg-[var(--accent)] text-[var(--accent-fg)] font-semibold rounded-lg px-3 py-1.5 disabled:opacity-40"
                    >
                      שמור ניסוח
                    </button>
                    <button onClick={() => setEditing(null)} className="text-xs text-[var(--muted)] px-2">ביטול</button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => answer(q.id)}
                      disabled={busy === q.id || !(drafts[q.id] ?? "").trim()}
                      className="text-xs bg-[var(--accent)] text-[var(--accent-fg)] font-semibold rounded-lg px-3 py-1.5 disabled:opacity-40"
                    >
                      {busy === q.id ? "שומר…" : "שמור — הבוט ילמד"}
                    </button>
                    <button
                      onClick={() => remove(q.id, "לסמן את השאלה כלא רלוונטית ולהסיר אותה?")}
                      disabled={busy === q.id}
                      className="text-xs text-[var(--muted)] hover:text-red-400 px-2"
                    >
                      לא רלוונטית
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* ===== מה שהבוט למד ===== */}
      <SectionCard
        title="מה שהבוט כבר למד"
        badge={answered.length}
        sub="הידע הפעיל של הבוט - אפשר לערוך, לבדוק ולשלוח תשובה למי ששאל."
        actions={
          <button
            onClick={() => { setAdding((a) => !a); setAddErr(""); }}
            className="text-xs bg-[var(--accent)] text-[var(--accent-fg)] font-semibold rounded-lg px-3 py-1.5"
          >
            {adding ? "סגור" : "+ הוסף ידע"}
          </button>
        }
      >
        {adding && (
          <div className="bg-[var(--panel2)] border border-[var(--accent)]/40 rounded-xl p-3.5 mb-3 space-y-2">
            <div className="text-xs text-[var(--muted)]">לימוד יזום: שאלה שלקוחות עשויים לשאול + התשובה שהבוט ייתן.</div>
            <input
              value={newQ}
              onChange={(e) => setNewQ(e.target.value)}
              placeholder="השאלה (למשל: יש עוגות ללא גלוטן?)"
              className="w-full bg-[var(--panel)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            />
            <textarea
              value={newA}
              onChange={(e) => setNewA(e.target.value)}
              rows={2}
              placeholder="התשובה…"
              className="w-full bg-[var(--panel)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            />
            {addErr && <div className="text-xs text-red-400">⚠ {addErr}</div>}
            <button
              onClick={addNew}
              disabled={busy === "new"}
              className="text-xs bg-[var(--accent)] text-[var(--accent-fg)] font-semibold rounded-lg px-3 py-1.5 disabled:opacity-40"
            >
              {busy === "new" ? "שומר…" : "שמור"}
            </button>
          </div>
        )}

        {answered.length > 3 && (
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש בידע שנלמד…"
            aria-label="חיפוש בידע"
            className="w-full bg-[var(--panel2)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm outline-none focus:border-[var(--accent)] mb-2"
          />
        )}

        {loaded && filteredAnswered.length === 0 && (
          <div className="p-4 text-center text-xs text-[var(--muted)]">
            {answered.length === 0 ? "עוד לא נלמד ידע. כשתענה על שאלה פתוחה - היא תופיע כאן." : "אין תוצאות לחיפוש"}
          </div>
        )}

        <div className="space-y-2">
          {filteredAnswered.map((q) => (
            <div key={q.id} className="bg-[var(--panel)] border border-[var(--border)] rounded-xl p-3 text-sm">
              {editing === q.id ? (
                <div className="space-y-2">
                  <input
                    value={editQ}
                    onChange={(e) => setEditQ(e.target.value)}
                    className="w-full font-medium bg-[var(--panel)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
                    aria-label="עריכת השאלה"
                  />
                  <textarea
                    value={editA}
                    onChange={(e) => setEditA(e.target.value)}
                    rows={3}
                    className="w-full bg-[var(--panel)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
                    aria-label="עריכת התשובה"
                  />
                  {editErr && <div className="text-xs text-red-400">⚠ {editErr}</div>}
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveEdit(q)}
                      disabled={busy === q.id}
                      className="text-xs bg-[var(--accent)] text-[var(--accent-fg)] font-semibold rounded-lg px-3 py-1.5 disabled:opacity-40"
                    >
                      {busy === q.id ? "שומר…" : "שמור"}
                    </button>
                    <button onClick={() => setEditing(null)} className="text-xs text-[var(--muted)] px-2">ביטול</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{q.question}</div>
                      <div className="text-[var(--muted)] text-xs mt-0.5 whitespace-pre-wrap">{q.answer}</div>
                      <div className="text-[10px] text-[var(--muted)] mt-1.5">
                        נלמדה {fmtDate(q.answeredAt ?? q.createdAt)}
                        {q.updatedAt && q.updatedAt !== q.answeredAt ? ` · עודכנה ${fmtDate(q.updatedAt)}` : ""}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0 items-end">
                      <button onClick={() => startEdit(q)} className="text-xs text-[var(--accent)] hover:underline">
                        ערוך
                      </button>
                      {onTest && (
                        <button onClick={() => onTest(q.question)} className="text-xs text-[var(--muted)] hover:text-[var(--text)]">
                          בדוק בבוט
                        </button>
                      )}
                      <button
                        onClick={() => remove(q.id, "למחוק את פריט הידע? הבוט יפסיק להשתמש בו.")}
                        className="text-[var(--muted)] hover:text-red-400 text-xs"
                      >
                        מחק
                      </button>
                    </div>
                  </div>
                  {(q.askers ?? []).length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-[var(--border)] pt-2">
                      <span className="text-[10px] text-[var(--muted)]">שלח את התשובה למי ששאל:</span>
                      {(q.askers ?? []).map((a, i) => {
                        const key = q.id + ":" + a.conversationId;
                        const done = a.answerSent || sentTo.has(key);
                        return (
                          <button
                            key={i}
                            disabled={done || sending === key}
                            onClick={() => sendToAsker(q.id, a)}
                            className={`text-[10px] rounded-full px-2 py-0.5 border ${
                              done
                                ? "text-emerald-400 border-emerald-500/30 cursor-default"
                                : "text-[var(--accent)] border-[var(--accent)]/40 hover:bg-[var(--accent)]/10"
                            }`}
                          >
                            {done ? `✓ נשלח ל${a.name || "לקוח"}` : sending === key ? "שולח…" : `📤 ${a.name || "לקוח"}`}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {justSaved === q.id && (
                    <div className="mt-2 text-xs bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 rounded-lg px-2.5 py-1.5 flex items-center gap-2 flex-wrap">
                      נשמר ✓ הבוט כבר משתמש בתשובה המעודכנת.
                      {onTest && (
                        <button onClick={() => onTest(q.question)} className="underline font-semibold">
                          בדוק עכשיו בבוט
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
