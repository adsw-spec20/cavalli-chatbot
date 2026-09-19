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
  phrased: number;
  totalAtoms: number;
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
  /** הנוסח שבתוקף עכשיו, כשהסעיף נערך (text נשאר הנוסח המקורי) */
  currentText?: string;
  /** הסעיף הוסר מהמוח */
  removed?: boolean;
}
type AnswerStatus = "kept" | "changed" | "deleted" | "answered" | "irrelevant" | "unsure" | "skipped";
interface AnswerRec {
  status: AnswerStatus;
  answer?: string;
  at: number;
}

const fmt = (n: number) => n.toLocaleString("he-IL");

const STATUS_LABEL: Record<AnswerStatus, string> = {
  kept: "נכון, השאר",
  changed: "נוסח מחדש",
  deleted: "הוסר מהמוח",
  answered: "נענה",
  irrelevant: "לא רלוונטי",
  unsure: "לבירור מול הצוות",
  skipped: "נדלג",
};

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
  /** שאלה שכבר נענתה ונפתחה שוב לשינוי ההחלטה */
  const [revisitId, setRevisitId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  const loadOverview = useCallback(async () => {
    try {
      const d = await api<Overview>(token, "/brain-review");
      setOverview(d);
      setErr("");
      return d;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "טעינה נכשלה");
      return null;
    }
  }, [token]);

  // ההכנה (ניסוח השאלות) היא הדבר היחיד שדורש מודל, ובלעדיה כל נושא נפתח
  // בהמתנה. מבקשים אותה ברקע מיד עם פתיחת המסך, ומרעננים עד שהיא נגמרת - כך
  // שעד שנבחר נושא השאלות שלו כבר מוכנות.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    (async () => {
      const first = await loadOverview();
      if (!alive || !first || first.phrased >= first.totalAtoms) return;
      api(token, "/brain-review?prewarm=1").catch(() => undefined);
      let seen = first.phrased;
      let stuck = 0;
      const tick = async () => {
        if (!alive) return;
        const d = await loadOverview();
        if (!alive || !d || d.phrased >= d.totalAtoms) return;
        // ההכנה רצה בפונקציית רקע שיש לה תקרת זמן. אם המספר לא זז שתי בדיקות
        // ברצף, הריצה כנראה נקטעה - מבקשים שוב, והיא ממשיכה מאיפה שנעצרה.
        if (d.phrased === seen) stuck++;
        else {
          stuck = 0;
          seen = d.phrased;
        }
        if (stuck >= 2) {
          stuck = 0;
          api(token, "/brain-review?prewarm=1").catch(() => undefined);
        }
        timer = setTimeout(tick, 4000);
      };
      timer = setTimeout(tick, 4000);
    })();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [loadOverview, token]);

  const loadTopic = useCallback(
    async (key: string, reset: boolean) => {
      if (reset) setLoading(true);
      setErr("");
      try {
        const d = await api<{ questions: Question[]; state: Record<string, AnswerRec> }>(token, `/brain-review?topic=${key}`);
        setQuestions(d.questions || []);
        setState(d.state || {});
        if (reset) setIdx(0);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "טעינה נכשלה");
      } finally {
        if (reset) setLoading(false);
      }
    },
    [token]
  );

  async function openTopic(key: string) {
    setTopicKey(key);
    setRevisitId(null);
    setShowDone(false);
    await loadTopic(key, true);
  }

  /** השאלות שעוד לא ענו עליהן, בסדר: סקירה ואז העשרה */
  const pending = useMemo(
    () => questions.filter((q) => !state[q.id] || state[q.id].status === "skipped"),
    [questions, state]
  );
  /** מה שכבר הוכרע - פתוח לשינוי בכל רגע */
  const answered = useMemo(
    () => questions.filter((q) => state[q.id] && state[q.id].status !== "skipped"),
    [questions, state]
  );
  const revisiting = revisitId ? questions.find((q) => q.id === revisitId) : undefined;
  const current = revisiting ?? pending[idx];
  const prevAnswer = current ? state[current.id] : undefined;
  const doneInTopic = answered.length;

  /** הנוסח שבתוקף במוח עכשיו - זה מה שעורכים ומה שמציגים, לא הנוסח שהוחלף */
  const liveText = current?.currentText ?? current?.text ?? "";

  useEffect(() => {
    setMode("buttons");
    setShowText(false);
    setDraft(current?.kind === "enrich" ? "" : (current?.currentText ?? current?.text ?? ""));
  }, [current]);

  async function answer(status: AnswerStatus, text?: string) {
    if (!current || busy) return;
    setBusy(true);
    setErr("");
    const id = current.id;
    try {
      await api(token, "/brain-review", {
        method: "POST",
        body: JSON.stringify({ questionId: id, status, answer: text }),
      });
      setLastAnswered(status === "skipped" ? null : id);
      setRevisitId(null);
      if (status === "skipped") {
        setState((s) => ({ ...s, [id]: { status, at: Date.now() } }));
        setIdx((i) => i + 1);
      } else if (topicKey) {
        // שינוי או מחיקה משנים את הפרומפט עצמו, ולכן גם את רשימת הסעיפים -
        // מרעננים מהשרת במקום לנחש מקומית.
        await loadTopic(topicKey, false);
      }
      loadOverview();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  /** ביטול החלטה: הסעיף חוזר לנוסח המקורי והשאלה חוזרת לתור */
  async function undo(id: string) {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      await api(token, "/brain-review", { method: "POST", body: JSON.stringify({ questionId: id, action: "undo" }) });
      if (lastAnswered === id) setLastAnswered(null);
      setRevisitId(null);
      if (topicKey) await loadTopic(topicKey, false);
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

        {overview && overview.phrased < overview.totalAtoms && (
          <div className="bg-[var(--panel2)] border border-[var(--border)] rounded-xl px-3 py-2.5 text-[13px] space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="animate-pulse" aria-hidden>
                ⏳
              </span>
              <span>
                מכין את השאלות ברקע - <b style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(overview.phrased)}</b> מתוך{" "}
                <b style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(overview.totalAtoms)}</b> מוכנות
              </span>
            </div>
            <Bar done={overview.phrased} total={overview.totalAtoms} />
            <div className="text-[11px] text-[var(--muted)]">
              אפשר להתחיל עכשיו, זה רק אומר שנושא שעוד לא הוכן ייקח כמה שניות להיפתח. ההכנה נעשית פעם אחת בלבד.
            </div>
          </div>
        )}

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
        {lastAnswered && !revisitId && (
          <button
            onClick={() => undo(lastAnswered)}
            disabled={busy}
            className="mr-auto text-xs text-[var(--muted)] hover:text-[var(--text)] underline"
          >
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
          <div className="text-sm text-[var(--muted)]">
            כל התשובות כבר בתוקף אצל הבוט. תמיד אפשר לפתוח שאלה שכבר ענית ולשנות את ההחלטה.
          </div>
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
        <div
          className={`bg-[var(--panel)] border rounded-2xl p-4 space-y-3 ${
            revisiting ? "border-[var(--accent)]" : "border-[var(--border)]"
          }`}
        >
          {revisiting && prevAnswer && (
            <div className="flex items-center gap-2 flex-wrap text-[12px] bg-[var(--panel2)] rounded-xl px-3 py-2">
              <span>
                ענית כאן: <b>{STATUS_LABEL[prevAnswer.status]}</b>
              </span>
              {(prevAnswer.status === "changed" || prevAnswer.status === "deleted") && (
                <button onClick={() => undo(current.id)} disabled={busy} className="text-[var(--accent)] underline">
                  שחזר את הנוסח המקורי
                </button>
              )}
              <button
                onClick={() => setRevisitId(null)}
                className="mr-auto text-[var(--muted)] hover:text-[var(--text)] underline"
              >
                חזרה לתור
              </button>
            </div>
          )}

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
                {showText ? "הסתר את הנוסח המדויק" : current.removed ? "הצג את מה שהוסר" : "הצג את הנוסח המדויק"}
              </button>
              {showText && (
                <>
                  <pre
                    className={`mt-2 whitespace-pre-wrap text-[12px] leading-relaxed bg-[var(--panel2)] rounded-xl p-3 max-h-56 overflow-y-auto ${
                      current.removed ? "line-through opacity-60" : ""
                    }`}
                  >
                    {current.removed ? current.text : liveText}
                  </pre>
                  {current.currentText && (
                    <details className="mt-1.5">
                      <summary className="text-[11px] text-[var(--muted)] cursor-pointer">
                        זה נוסח ערוך. להצגת הנוסח המקורי
                      </summary>
                      <pre className="mt-1.5 whitespace-pre-wrap text-[12px] leading-relaxed bg-[var(--panel2)] rounded-xl p-3 max-h-56 overflow-y-auto opacity-70">
                        {current.text}
                      </pre>
                    </details>
                  )}
                </>
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
                {current.removed ? "↩️ החזר למוח" : "✅ נכון, השאר"}
              </button>
              <button
                onClick={() => {
                  setDraft(liveText);
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

      {/* מה שכבר הוכרע - פתוח לשינוי. לחיצה אחת בלי לקרוא היא טעות קלה לעשות,
          ובלי הדרך הזאת היא הייתה בלתי הפיכה אחרי שהשאלה הבאה נטענה. */}
      {!loading && answered.length > 0 && (
        <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl overflow-hidden">
          <button
            onClick={() => setShowDone((s) => !s)}
            className="w-full px-4 py-3 flex items-center gap-2 text-right hover:bg-[var(--panel2)] transition"
          >
            <span className="text-sm font-semibold">✅ שאלות שכבר ענית</span>
            <span className="text-[11px] text-[var(--muted)]" style={{ fontVariantNumeric: "tabular-nums" }}>
              {fmt(answered.length)}
            </span>
            <span className="mr-auto text-[var(--muted)] text-xs">{showDone ? "▲" : "▼"}</span>
          </button>
          {showDone && (
            <div className="border-t border-[var(--border)] divide-y divide-[var(--border)]">
              {answered.map((q) => (
                <button
                  key={q.id}
                  onClick={() => {
                    setRevisitId(q.id);
                    setShowDone(false);
                  }}
                  className={`w-full px-4 py-2.5 text-right hover:bg-[var(--panel2)] transition flex items-start gap-2 ${
                    revisitId === q.id ? "bg-[var(--panel2)]" : ""
                  }`}
                >
                  <span className="text-[10px] shrink-0 mt-0.5 px-1.5 py-0.5 rounded-full bg-[var(--panel2)] text-[var(--muted)] whitespace-nowrap">
                    {STATUS_LABEL[state[q.id].status]}
                  </span>
                  <span className="text-[13px] leading-snug min-w-0">{q.question}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
