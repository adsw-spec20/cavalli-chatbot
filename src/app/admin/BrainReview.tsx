"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./types";

/**
 * "בירור המוח" - המסך שבו המנהל עובר על כל מה שהבוט יודע, נושא-נושא,
 * ועונה על שאלה אחת בכל פעם. כל תשובה נכנסת לבוט מיד (דרך שכבת הדריסות),
 * והכל הפיך. מחליף את השאלון הסטטי, שלא שיקף את המוח האמיתי.
 */

interface TopicSummary {
  key: string;
  title: string;
  icon: string;
  total: number;
  done: number;
  tokens: number;
}
interface Overview {
  topics: TopicSummary[];
  totalQuestions: number;
  totalDone: number;
  promptTokens: number;
  tokensSaved: number;
}
interface Question {
  id: string;
  kind: "review" | "enrich";
  topic: string;
  question: string;
  summary: string;
  text?: string;
  tokens?: number;
  evidence?: string;
}
type AnswerStatus = "kept" | "changed" | "deleted" | "answered" | "irrelevant" | "unsure" | "skipped";
interface AnswerRec {
  status: AnswerStatus;
  answer?: string;
  at: number;
}

const fmt = (n: number) => n.toLocaleString("he-IL");

function Bar({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="h-2 flex-1 rounded-full bg-[var(--panel2)] overflow-hidden">
        <div className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] text-[var(--muted)] shrink-0" style={{ fontVariantNumeric: "tabular-nums" }}>
        {pct}%
      </span>
    </div>
  );
}

export default function BrainReview({ token }: { token: string }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [topicKey, setTopicKey] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [state, setState] = useState<Record<string, AnswerRec>>({});
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<"buttons" | "edit">("buttons");
  const [showText, setShowText] = useState(false);
  const [lastAnswered, setLastAnswered] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    try {
      setOverview(await api<Overview>(token, "/brain-review"));
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "טעינה נכשלה");
    }
  }, [token]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  async function openTopic(key: string) {
    setTopicKey(key);
    setLoading(true);
    setErr("");
    try {
      const d = await api<{ questions: Question[]; state: Record<string, AnswerRec> }>(token, `/brain-review?topic=${key}`);
      setQuestions(d.questions || []);
      setState(d.state || {});
      setIdx(0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "טעינה נכשלה");
    } finally {
      setLoading(false);
    }
  }

  /** השאלות שעוד לא ענו עליהן, בסדר: סקירה ואז העשרה */
  const pending = useMemo(
    () => questions.filter((q) => !state[q.id] || state[q.id].status === "skipped"),
    [questions, state]
  );
  const current = pending[idx];
  const doneInTopic = questions.length - pending.length;

  useEffect(() => {
    setMode("buttons");
    setShowText(false);
    setDraft(current?.kind === "enrich" ? "" : (current?.text ?? ""));
  }, [current]);

  async function answer(status: AnswerStatus, text?: string) {
    if (!current || busy) return;
    setBusy(true);
    setErr("");
    try {
      await api(token, "/brain-review", {
        method: "POST",
        body: JSON.stringify({ questionId: current.id, status, answer: text }),
      });
      setState((s) => ({ ...s, [current.id]: { status, answer: text, at: Date.now() } }));
      setLastAnswered(status === "skipped" ? null : current.id);
      if (status === "skipped") setIdx((i) => i + 1);
      loadOverview();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (!lastAnswered || busy) return;
    setBusy(true);
    try {
      await api(token, "/brain-review", { method: "POST", body: JSON.stringify({ questionId: lastAnswered, action: "undo" }) });
      setState((s) => {
        const n = { ...s };
        delete n[lastAnswered];
        return n;
      });
      setLastAnswered(null);
      setIdx(0);
      loadOverview();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "הביטול נכשל");
    } finally {
      setBusy(false);
    }
  }

  // ===== מפת הנושאים =====
  if (!topicKey) {
    return (
      <div className="space-y-4 max-w-[860px]">
        <div className="text-sm text-[var(--muted)] leading-relaxed">
          כאן עוברים על <b className="text-[var(--text)]">כל מה שהבוט יודע</b>, נושא אחרי נושא. כל תשובה נכנסת לבוט
          באותו רגע, והכל הפיך. בוחרים נושא, ועונים על שאלה אחת בכל פעם.
        </div>

        {err && <div className="text-sm text-red-400">⚠ {err}</div>}

        {overview && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="bg-[var(--panel)] border border-[var(--border)] rounded-xl px-3 py-2.5">
              <div className="text-2xl font-bold font-display" style={{ fontVariantNumeric: "tabular-nums" }}>
                {fmt(overview.totalDone)}
              </div>
              <div className="text-[11px] text-[var(--muted)] mt-0.5">שאלות שנסגרו</div>
            </div>
            <div className="bg-[var(--panel)] border border-[var(--border)] rounded-xl px-3 py-2.5">
              <div className="text-2xl font-bold font-display" style={{ fontVariantNumeric: "tabular-nums" }}>
                {fmt(overview.totalQuestions - overview.totalDone)}
              </div>
              <div className="text-[11px] text-[var(--muted)] mt-0.5">נשארו</div>
            </div>
            <div className="bg-[var(--panel)] border border-[var(--border)] rounded-xl px-3 py-2.5">
              <div className="text-2xl font-bold font-display" style={{ fontVariantNumeric: "tabular-nums" }}>
                {fmt(overview.promptTokens)}
              </div>
              <div className="text-[11px] text-[var(--muted)] mt-0.5">טוקנים במוח</div>
            </div>
            <div className="bg-[var(--panel)] border border-[var(--border)] rounded-xl px-3 py-2.5">
              <div className="text-2xl font-bold font-display text-emerald-500" style={{ fontVariantNumeric: "tabular-nums" }}>
                {overview.tokensSaved ? `-${fmt(overview.tokensSaved)}` : "0"}
              </div>
              <div className="text-[11px] text-[var(--muted)] mt-0.5">נחסכו עד כה</div>
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          {!overview && <div className="text-sm text-[var(--muted)] p-4">טוען…</div>}
          {overview?.topics.map((t) => {
            const left = t.total - t.done;
            return (
              <button
                key={t.key}
                onClick={() => openTopic(t.key)}
                className="w-full bg-[var(--panel)] border border-[var(--border)] rounded-xl px-3.5 py-3 flex items-center gap-3 text-right hover:border-[var(--accent)] transition"
              >
                <span className="text-xl shrink-0" aria-hidden>
                  {t.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <b className="text-sm">{t.title}</b>
                    <span className="text-[11px] text-[var(--muted)]" style={{ fontVariantNumeric: "tabular-nums" }}>
                      {left > 0 ? `${fmt(left)} שאלות` : "הושלם ✓"}
                    </span>
                  </span>
                  <span className="block mt-1.5">
                    <Bar done={t.done} total={t.total} />
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ===== מסך השאלות של נושא =====
  const t = overview?.topics.find((x) => x.key === topicKey);
  return (
    <div className="space-y-3 max-w-[760px]">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => {
            setTopicKey(null);
            loadOverview();
          }}
          className="text-sm rounded-lg px-3 py-1.5 border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
        >
          → כל הנושאים
        </button>
        <b className="text-sm">
          {t?.icon} {t?.title}
        </b>
        <span className="text-xs text-[var(--muted)]" style={{ fontVariantNumeric: "tabular-nums" }}>
          {fmt(doneInTopic)} / {fmt(questions.length)}
        </span>
        {lastAnswered && (
          <button onClick={undo} disabled={busy} className="mr-auto text-xs text-[var(--muted)] hover:text-[var(--text)] underline">
            ביטול אחרון
          </button>
        )}
      </div>

      <Bar done={doneInTopic} total={questions.length} />

      {err && <div className="text-sm text-red-400">⚠ {err}</div>}
      {loading && <div className="text-sm text-[var(--muted)] p-6 text-center">מכין את השאלות…</div>}

      {!loading && !current && (
        <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-8 text-center space-y-2">
          <div className="text-3xl">🎉</div>
          <div className="font-semibold">סיימת את הנושא הזה</div>
          <div className="text-sm text-[var(--muted)]">כל התשובות כבר בתוקף אצל הבוט.</div>
          <button
            onClick={() => {
              setTopicKey(null);
              loadOverview();
            }}
            className="mt-2 rounded-xl px-4 py-2 text-sm bg-[var(--accent)] text-[var(--accent-fg)] font-semibold"
          >
            לנושא הבא
          </button>
        </div>
      )}

      {!loading && current && (
        <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
            <span className={`px-2 py-0.5 rounded-full ${current.kind === "enrich" ? "bg-emerald-500/15 text-emerald-500" : "bg-[var(--panel2)]"}`}>
              {current.kind === "enrich" ? "מידע חסר" : "סקירה"}
            </span>
            {current.evidence && <span>📊 {current.evidence}</span>}
            {current.tokens ? <span>💾 {fmt(current.tokens)} טוקנים</span> : null}
          </div>

          {current.summary && <div className="text-sm text-[var(--muted)]">{current.summary}</div>}
          <div className="text-[17px] font-semibold leading-snug">{current.question}</div>

          {current.text && (
            <div>
              <button onClick={() => setShowText((s) => !s)} className="text-xs text-[var(--accent)] underline">
                {showText ? "הסתר את הנוסח המדויק" : "הצג את הנוסח המדויק"}
              </button>
              {showText && (
                <pre className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed bg-[var(--panel2)] rounded-xl p-3 max-h-56 overflow-y-auto">
                  {current.text}
                </pre>
              )}
            </div>
          )}

          {/* העשרה: תיבת תשובה חופשית */}
          {current.kind === "enrich" && (
            <div className="space-y-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={4}
                placeholder="התשובה שלך - כמו שהיית מסביר ללקוח…"
                className="w-full bg-[var(--panel2)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
              />
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => answer("answered", draft)}
                  disabled={busy || !draft.trim()}
                  className="text-sm font-semibold rounded-xl px-4 py-2 bg-[var(--accent)] text-[var(--accent-fg)] disabled:opacity-40"
                >
                  {busy ? "שומר…" : "שמור והבא"}
                </button>
                <button onClick={() => answer("irrelevant")} disabled={busy} className="text-sm rounded-xl px-3 py-2 border border-[var(--border)] text-[var(--muted)]">
                  לא רלוונטי
                </button>
                <button onClick={() => answer("skipped")} disabled={busy} className="text-sm rounded-xl px-3 py-2 text-[var(--muted)]">
                  דלג
                </button>
              </div>
            </div>
          )}

          {/* סקירה: ארבעה כפתורי החלטה */}
          {current.kind === "review" && mode === "buttons" && (
            <div className="flex gap-2 flex-wrap pt-1">
              <button
                onClick={() => answer("kept")}
                disabled={busy}
                className="text-sm font-semibold rounded-xl px-4 py-2 bg-emerald-500/15 text-emerald-600 border border-emerald-500/40"
              >
                ✅ נכון, השאר
              </button>
              <button
                onClick={() => {
                  setDraft(current.text ?? "");
                  setMode("edit");
                  setShowText(true);
                }}
                disabled={busy}
                className="text-sm rounded-xl px-4 py-2 border border-[var(--border)] hover:border-[var(--accent)]"
              >
                ✏️ שנה
              </button>
              <button
                onClick={() => answer("deleted")}
                disabled={busy}
                className="text-sm rounded-xl px-4 py-2 bg-red-500/10 text-red-500 border border-red-500/30"
              >
                🗑️ לא רלוונטי
              </button>
              <button onClick={() => answer("unsure")} disabled={busy} className="text-sm rounded-xl px-3 py-2 border border-[var(--border)] text-[var(--muted)]">
                ❓ לא בטוח
              </button>
              <button onClick={() => answer("skipped")} disabled={busy} className="text-sm rounded-xl px-3 py-2 text-[var(--muted)]">
                דלג
              </button>
            </div>
          )}

          {current.kind === "review" && mode === "edit" && (
            <div className="space-y-2">
              <div className="text-xs text-[var(--muted)]">ערוך את הנוסח. זה מה שהבוט יקבל מרגע השמירה:</div>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={6}
                className="w-full bg-[var(--panel2)] border border-[var(--border)] rounded-xl px-3 py-2 text-[13px] leading-relaxed outline-none focus:border-[var(--accent)]"
              />
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => answer("changed", draft)}
                  disabled={busy || !draft.trim()}
                  className="text-sm font-semibold rounded-xl px-4 py-2 bg-[var(--accent)] text-[var(--accent-fg)] disabled:opacity-40"
                >
                  {busy ? "שומר…" : "שמור והבא"}
                </button>
                <button onClick={() => setMode("buttons")} className="text-sm rounded-xl px-3 py-2 text-[var(--muted)]">
                  ביטול
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
