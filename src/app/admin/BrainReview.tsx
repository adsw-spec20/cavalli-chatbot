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
  from: number;
  to: number;
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
  /** המספר הרציף של השאלה בכל הבירור */
  num?: number;
  text?: string;
  tokens?: number;
  evidence?: string;
  /** הנוסח שבתוקף עכשיו, כשהסעיף נערך (text נשאר הנוסח המקורי) */
  currentText?: string;
  /** הסעיף הוסר מהמוח */
  removed?: boolean;
}
type AnswerStatus =
  | "kept"
  | "changed"
  | "deleted"
  | "answered"
  | "irrelevant"
  | "unsure"
  | "technical"
  | "skipped";
interface AnswerRec {
  status: AnswerStatus;
  answer?: string;
  at: number;
  note?: string;
}

const fmt = (n: number) => n.toLocaleString("he-IL");

const STATUS_LABEL: Record<AnswerStatus, string> = {
  kept: "נכון, השאר",
  changed: "נוסח מחדש",
  deleted: "הוסר מהמוח",
  answered: "נענה",
  irrelevant: "לא רלוונטי",
  unsure: "לבירור מול הצוות",
  technical: "טכני, לא בשבילי",
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
  /** רשימת כל מה שנסגר בכל הנושאים (null = לא פתוחה) */
  const [allDone, setAllDone] = useState<Question[] | null>(null);
  /** הערה חופשית על השאלה הנוכחית - נשמרת יחד עם ההחלטה, ולא מגיעה לבוט */
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);

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

  async function openTopic(key: string, revisit?: string) {
    setTopicKey(key);
    setRevisitId(revisit ?? null);
    setShowDone(false);
    setAllDone(null);
    await loadTopic(key, true);
  }

  /** רשימת כל מה שנסגר, מכל הנושאים - נפתחת מה-KPI */
  async function openAllDone() {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      const d = await api<{ questions: Question[]; state: Record<string, AnswerRec> }>(token, "/brain-review?answered=1");
      setAllDone(d.questions || []);
      setState(d.state || {});
    } catch (e) {
      setErr(e instanceof Error ? e.message : "טעינה נכשלה");
    } finally {
      setBusy(false);
    }
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
    // סעיף שכבר נערך או הוסר נפתח עם הנוסח גלוי: אחרת מה שרואים הוא השאלה
    // שנוסחה מהטקסט הישן, וזה נראה כאילו העריכה לא נשמרה (דווח 22.9).
    setShowText(!!(current?.currentText || current?.removed));
    setDraft(current?.kind === "enrich" ? "" : (current?.currentText ?? current?.text ?? ""));
    const saved = current ? state[current.id]?.note ?? "" : "";
    setNote(saved);
    setShowNote(!!saved);
    setNoteSaved(false);
  }, [current, state]);

  async function answer(status: AnswerStatus, text?: string) {
    if (!current || busy) return;
    setBusy(true);
    setErr("");
    const id = current.id;
    try {
      await api(token, "/brain-review", {
        method: "POST",
        body: JSON.stringify({ questionId: id, status, answer: text, note }),
      });
      setLastAnswered(status === "skipped" ? null : id);
      setRevisitId(null);
      if (status === "skipped") {
        setState((s) => ({ ...s, [id]: { status, at: Date.now(), note: note.trim() || undefined } }));
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

  /** ניסוח מחדש של כל השאלות - התשובות וההערות נשמרות */
  async function rephraseAll() {
    if (busy) return;
    if (
      !window.confirm(
        "לנסח מחדש את כל השאלות?\n\nהתשובות, ההערות והעריכות שלך נשמרות ולא ייפגעו.\nההכנה תיקח כמה דקות ברקע, ובסופה המספור עשוי לזוז מעט (שאלות שיסווגו כטכניות יורדות מהרשימה)."
      )
    )
      return;
    setBusy(true);
    setErr("");
    try {
      await api(token, "/brain-review", { method: "POST", body: JSON.stringify({ action: "rephrase" }) });
      setTopicKey(null);
      setAllDone(null);
      setQuestions([]);
      await loadOverview();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "הניסוח מחדש נכשל");
    } finally {
      setBusy(false);
    }
  }

  /** איפוס כל הבירור - מוחק תשובות והערות ומחזיר את המוח לנוסח המקורי */
  async function resetAll() {
    if (busy) return;
    const done = overview?.totalDone ?? 0;
    if (!window.confirm(`לאפס את כל הבירור?\n\n${done} תשובות והערות יימחקו, וכל עריכה שעשית תוחזר לנוסח המקורי.\nכדאי להוריד קודם את הסיכום.`)) return;
    setBusy(true);
    setErr("");
    try {
      await api(token, "/brain-review", { method: "POST", body: JSON.stringify({ action: "reset", confirm: "reset" }) });
      setLastAnswered(null);
      setRevisitId(null);
      setTopicKey(null);
      setQuestions([]);
      setState({});
      await loadOverview();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "האיפוס נכשל");
    } finally {
      setBusy(false);
    }
  }

  /**
   * מוריד את הסיכום כקובץ. לא דרך api() כי זו תשובת טקסט ולא JSON, והטוקן
   * חייב לעבור בכותרת - ולכן מורידים דרך blob ולא בקישור ישיר.
   */
  async function exportSummary() {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/admin/brain-review?export=1", {
        cache: "no-store",
        headers: { "x-admin-token": token },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `בירור-המוח-${new Date().toISOString().slice(0, 10)}.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "הייצוא נכשל");
    } finally {
      setBusy(false);
    }
  }

  /**
   * שמירת ההערה בלי להכריע. בתור ממשיכים לשאלה הבאה (השאלה נשארת בתור
   * ותחזור בהמשך) - להישאר על אותה שאלה אחרי שמירה הרגיש כמו תקיעה. בחזרה
   * לשאלה שכבר נסגרה נשארים במקום, כי אין לאן להתקדם.
   */
  async function saveNoteOnly() {
    if (!current || busy) return;
    setBusy(true);
    setErr("");
    const id = current.id;
    const inQueue = !revisiting;
    try {
      await api(token, "/brain-review", { method: "POST", body: JSON.stringify({ questionId: id, action: "note", note }) });
      setState((s) => ({ ...s, [id]: { ...(s[id] ?? { status: "skipped" as AnswerStatus, at: Date.now() }), note: note.trim() || undefined } }));
      if (inQueue) setIdx((i) => i + 1);
      else setNoteSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "שמירת ההערה נכשלה");
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

  // ===== כל מה שנסגר, מכל הנושאים =====
  if (!topicKey && allDone) {
    const topicOf = (key: string) => overview?.topics.find((t) => t.key === key);
    return (
      <div className="space-y-3 max-w-[860px]">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setAllDone(null)}
            className="text-sm rounded-lg px-3 py-1.5 border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
          >
            → חזרה
          </button>
          <b className="text-sm">✅ שאלות שנסגרו</b>
          <span className="text-xs text-[var(--muted)]" style={{ fontVariantNumeric: "tabular-nums" }}>
            {fmt(allDone.length)}
          </span>
        </div>
        <div className="text-[12px] text-[var(--muted)]">לחיצה על שאלה פותחת אותה לשינוי ההחלטה, הנוסח או ההערה.</div>

        {err && <div className="text-sm text-red-400">⚠ {err}</div>}

        {!allDone.length && (
          <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-6 text-center text-sm text-[var(--muted)]">
            עוד לא נסגרה אף שאלה.
          </div>
        )}

        <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl overflow-hidden divide-y divide-[var(--border)]">
          {allDone.map((q) => {
            const t = topicOf(q.topic);
            const rec = state[q.id];
            return (
              <button
                key={q.id}
                onClick={() => openTopic(q.topic, q.id)}
                className="w-full px-3.5 py-3 text-right hover:bg-[var(--panel2)] transition flex items-start gap-2.5"
              >
                <span
                  className="text-[11px] shrink-0 mt-0.5 font-bold text-[var(--muted)] w-8"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {q.num ? fmt(q.num) : ""}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--panel2)] text-[var(--muted)] whitespace-nowrap">
                      {rec ? STATUS_LABEL[rec.status] : ""}
                    </span>
                    {t && (
                      <span className="text-[10px] text-[var(--muted)]">
                        {t.icon} {t.title}
                      </span>
                    )}
                    {q.currentText && <span className="text-[10px] text-emerald-600">✏️ נוסח חדש</span>}
                    {q.removed && <span className="text-[10px] text-red-500">🗑️ הוסר</span>}
                  </span>
                  <span className="block text-[13px] leading-snug mt-1">{q.question}</span>
                  {rec?.note && (
                    <span className="block text-[11px] text-[var(--muted)] mt-0.5">🗒️ {rec.note}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ===== מפת הנושאים =====
  if (!topicKey) {
    return (
      <div className="space-y-4 max-w-[860px]">
        <div className="text-sm text-[var(--muted)] leading-relaxed">
          כאן עוברים על <b className="text-[var(--text)]">כל מה שהבוט יודע</b>, נושא אחרי נושא. כל תשובה נכנסת לבוט
          באותו רגע, והכל הפיך. בוחרים נושא, ועונים על שאלה אחת בכל פעם. אפשר להוסיף הערה על כל שאלה.
        </div>

        {!!overview?.totalDone && (
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={exportSummary}
              disabled={busy}
              className="flex-1 text-sm rounded-xl px-4 py-2.5 border border-[var(--border)] hover:border-[var(--accent)] text-right"
            >
              📤 הורד סיכום להרכבת המוח החדש
              <span className="block text-[11px] text-[var(--muted)] mt-0.5">
                כל מה שהכרעת, עם הנוסחים המעודכנים וההערות, בקובץ אחד
              </span>
            </button>
            <button
              onClick={resetAll}
              disabled={busy}
              className="sm:w-[210px] text-sm rounded-xl px-4 py-2.5 border border-red-500/30 text-red-500 hover:bg-red-500/10 text-right"
            >
              ♻️ אפס את הבירור
              <span className="block text-[11px] opacity-70 mt-0.5">מוחק תשובות והערות ומחזיר נוסחים</span>
            </button>
          </div>
        )}

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
            <button
              onClick={openAllDone}
              disabled={busy || !overview.totalDone}
              className="bg-[var(--panel)] border border-[var(--border)] rounded-xl px-3 py-2.5 text-right enabled:hover:border-[var(--accent)] transition disabled:cursor-default"
            >
              <div className="text-2xl font-bold font-display" style={{ fontVariantNumeric: "tabular-nums" }}>
                {fmt(overview.totalDone)}
              </div>
              <div className="text-[11px] text-[var(--muted)] mt-0.5">
                שאלות שנסגרו{overview.totalDone ? " ›" : ""}
              </div>
            </button>
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
          {overview && (
            <div className="text-left pb-1">
              <button
                onClick={rephraseAll}
                disabled={busy}
                className="text-[11px] text-[var(--muted)] hover:text-[var(--text)] underline"
              >
                🔄 נסח מחדש את כל השאלות
              </button>
            </div>
          )}
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
                  <span className="flex items-center gap-2 flex-wrap">
                    <b className="text-sm">{t.title}</b>
                    {t.to > 0 && (
                      <span
                        className="text-[10px] text-[var(--muted)] bg-[var(--panel2)] rounded-full px-1.5 py-0.5"
                        style={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        שאלות {fmt(t.from)}-{fmt(t.to)}
                      </span>
                    )}
                    <span className="text-[11px] text-[var(--muted)]" style={{ fontVariantNumeric: "tabular-nums" }}>
                      {left > 0 ? `נשארו ${fmt(left)}` : "הושלם ✓"}
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
          <div className="text-3xl">{pending.length ? "↩️" : "🎉"}</div>
          <div className="font-semibold">
            {pending.length ? `עברת על הכל, אבל ${fmt(pending.length)} עוד מחכות להכרעה` : "סיימת את הנושא הזה"}
          </div>
          <div className="text-sm text-[var(--muted)]">
            {pending.length
              ? "אלה שדילגת עליהן או שרשמת עליהן רק הערה. אפשר לחזור אליהן עכשיו או להמשיך לנושא הבא ולחזור אחר כך."
              : "כל התשובות כבר בתוקף אצל הבוט. תמיד אפשר לפתוח שאלה שכבר ענית ולשנות את ההחלטה."}
          </div>
          <div className="flex gap-2 justify-center flex-wrap pt-1">
            {!!pending.length && (
              <button
                onClick={() => setIdx(0)}
                className="rounded-xl px-4 py-2 text-sm bg-[var(--accent)] text-[var(--accent-fg)] font-semibold"
              >
                חזור אליהן ({fmt(pending.length)})
              </button>
            )}
            <button
              onClick={() => {
                setTopicKey(null);
                loadOverview();
              }}
              className={`rounded-xl px-4 py-2 text-sm font-semibold ${
                pending.length
                  ? "border border-[var(--border)] text-[var(--muted)]"
                  : "bg-[var(--accent)] text-[var(--accent-fg)]"
              }`}
            >
              לנושא הבא
            </button>
          </div>
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
            {current.num ? (
              <span
                className="px-2 py-0.5 rounded-full bg-[var(--accent)] text-[var(--accent-fg)] font-bold"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                שאלה {fmt(current.num)}
              </span>
            ) : null}
            <span className={`px-2 py-0.5 rounded-full ${current.kind === "enrich" ? "bg-emerald-500/15 text-emerald-500" : "bg-[var(--panel2)]"}`}>
              {current.kind === "enrich" ? "מידע חסר" : "סקירה"}
            </span>
            {current.evidence && <span>📊 {current.evidence}</span>}
            {current.tokens ? <span>💾 {fmt(current.tokens)} טוקנים</span> : null}
          </div>

          {current.summary && (
            <div className={`text-sm text-[var(--muted)] ${current.currentText || current.removed ? "opacity-60" : ""}`}>
              {current.summary}
              {/* הסיכום והשאלה נוסחו מהטקסט המקורי ולא מתעדכנים אחרי עריכה -
                  בלי הסימון הזה הם נקראים כאילו הם מתארים את המצב הנוכחי */}
              {(current.currentText || current.removed) && (
                <span className="text-[11px]"> (מתאר את הנוסח המקורי, לפני השינוי שלך)</span>
              )}
            </div>
          )}
          <div className="text-[17px] font-semibold leading-snug">{current.question}</div>

          {current.text && (
            <div>
              <button onClick={() => setShowText((s) => !s)} className="text-xs text-[var(--accent)] underline">
                {showText ? "הסתר את הנוסח" : current.removed ? "הצג את מה שהוסר" : "הצג את הנוסח המדויק"}
              </button>
              {showText && (
                <>
                  {current.currentText && (
                    <div className="mt-2 text-[11px] text-emerald-600 font-semibold">✏️ הנוסח שבתוקף עכשיו (אחרי העריכה שלך):</div>
                  )}
                  <pre
                    className={`mt-1.5 whitespace-pre-wrap text-[12px] leading-relaxed rounded-xl p-3 max-h-56 overflow-y-auto ${
                      current.removed
                        ? "line-through opacity-60 bg-[var(--panel2)]"
                        : current.currentText
                          ? "bg-emerald-500/10 border border-emerald-500/30"
                          : "bg-[var(--panel2)]"
                    }`}
                  >
                    {current.removed ? current.text : liveText}
                  </pre>
                  {current.currentText && (
                    <details className="mt-1.5">
                      <summary className="text-[11px] text-[var(--muted)] cursor-pointer">
                        להצגת הנוסח המקורי שהוחלף
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

          {/* הערה חופשית - נאספת לסיכום שממנו נבנה המוח החדש, לא נשלחת לבוט */}
          <div className="border-t border-[var(--border)] pt-2.5">
            {!showNote && !note ? (
              <button onClick={() => setShowNote(true)} className="text-xs text-[var(--accent)] underline">
                🗒️ הוסף הערה
              </button>
            ) : (
              <div className="space-y-1.5">
                <div className="text-[11px] text-[var(--muted)]">
                  הערה (לא נשלחת לבוט - נאספת לסיכום שממנו נרכיב את המוח החדש)
                </div>
                <textarea
                  value={note}
                  onChange={(e) => {
                    setNote(e.target.value);
                    setNoteSaved(false);
                  }}
                  rows={2}
                  placeholder="למשל: נכון, אבל תוסיף שבחורף זה אחרת / לא רלוונטי, עניתי על זה בשאלת הפיקדון"
                  className="w-full bg-[var(--panel2)] border border-[var(--border)] rounded-xl px-3 py-2 text-[13px] outline-none focus:border-[var(--accent)]"
                />
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={saveNoteOnly}
                    disabled={busy || !note.trim()}
                    className="text-xs rounded-lg px-2.5 py-1 border border-[var(--border)] hover:border-[var(--accent)] disabled:opacity-40"
                  >
                    {revisiting ? "שמור הערה" : "שמור הערה והמשך (בלי להכריע)"}
                  </button>
                  {noteSaved && <span className="text-[11px] text-emerald-600">נשמרה ✓</span>}
                  <span className="text-[11px] text-[var(--muted)]">
                    {revisiting
                      ? "ההערה נשמרת גם עם כל כפתור החלטה למטה"
                      : "השאלה תישאר בתור ותחזור אליך. אם אתה כן מכריע - פשוט לחץ על כפתור למטה וההערה תישמר איתו."}
                  </span>
                </div>
              </div>
            )}
          </div>

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
              <button
                onClick={() => answer("technical")}
                disabled={busy}
                title="הנחיה פנימית של הבוט. לא משנה כלום, יורדת מהתור, ואני אטפל בה"
                className="text-sm rounded-xl px-3 py-2 border border-[var(--border)] text-[var(--muted)]"
              >
                🔧 לא בשבילי
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
                  <span className="text-[13px] leading-snug min-w-0">
                    {q.num ? (
                      <b className="text-[var(--muted)]" style={{ fontVariantNumeric: "tabular-nums" }}>
                        {fmt(q.num)}.{" "}
                      </b>
                    ) : null}
                    {q.question}
                    {state[q.id].note && (
                      <span className="block text-[11px] text-[var(--muted)] mt-0.5">🗒️ {state[q.id].note}</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
