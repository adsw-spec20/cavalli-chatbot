"use client";

/**
 * טאב "שאלון" - שאלון הידע הגדול (234 שאלות מ-15 קטגוריות, מבוסס מחקר השיחות).
 * עונים בשפה חופשית, כל תשובה נשמרת מיד בשרת (עצירה והמשך מכל מכשיר), ומשם
 * מוטמעת לידע/קונפיג של הבוט. ⭐ = שאלה שלקוחות אמיתיים שאלו.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./types";
import { QUIZ, TOP10 } from "./questionnaire-data";

interface QAnswer {
  answer?: string;
  skipped?: boolean;
  ts: number;
  by?: string;
}

export default function Questionnaire({ token, agentName }: { token: string; agentName: string }) {
  const [answers, setAnswers] = useState<Record<string, QAnswer>>({});
  const [loaded, setLoaded] = useState(false);
  const [openCat, setOpenCat] = useState<number | null>(0);
  const [savedFlash, setSavedFlash] = useState("");
  const [starredOnly, setStarredOnly] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    api<Record<string, QAnswer>>(token, "/questionnaire")
      .then((a) => {
        setAnswers(a);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [token]);

  const total = useMemo(() => QUIZ.reduce((s, c) => s + c.questions.length, 0), []);
  const done = Object.values(answers).filter((a) => a.answer || a.skipped).length;

  async function save(id: string, patch: { answer?: string; skipped?: boolean }) {
    const next = { ...answers };
    if (!patch.answer?.trim() && !patch.skipped) delete next[id];
    else next[id] = { ...patch, ts: Date.now(), by: agentName || "מנהל" };
    setAnswers(next);
    try {
      await api(token, "/questionnaire", {
        method: "POST",
        body: JSON.stringify({ id, ...patch, by: agentName || "מנהל" }),
      });
      setSavedFlash(id);
      setTimeout(() => setSavedFlash(""), 1200);
    } catch {
      /* יישמר בניסיון הבא */
    }
  }

  function onType(id: string, v: string) {
    setDrafts((d) => ({ ...d, [id]: v }));
    clearTimeout(saveTimers.current[id]);
    saveTimers.current[id] = setTimeout(() => save(id, { answer: v }), 900);
  }

  if (!loaded) return <div className="p-8 text-center text-sm text-[var(--muted)]">טוען שאלון…</div>;

  return (
    <div className="max-w-3xl mx-auto space-y-4 pb-8">
      {/* התקדמות */}
      <section className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-4 space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="font-semibold">
            🧠 {done} / {total} נענו
            {savedFlash && <span className="text-emerald-400 text-xs mr-2">נשמר ✓</span>}
          </div>
          <label className="flex items-center gap-1.5 text-xs text-[var(--muted)] cursor-pointer">
            <input type="checkbox" checked={starredOnly} onChange={(e) => setStarredOnly(e.target.checked)} />
            רק ⭐ (שאלות שלקוחות שאלו בפועל)
          </label>
        </div>
        <div className="h-2 rounded-full bg-[var(--panel2)] overflow-hidden">
          <div
            className="h-full bg-[var(--accent)] transition-all"
            style={{ width: `${Math.round((done / total) * 100)}%` }}
          />
        </div>
        <p className="text-xs text-[var(--muted)]">
          עונים בשפה חופשית ("250 בחוץ 100 בפנים" זה מצוין) - כל תשובה נשמרת אוטומטית, אפשר לעצור ולהמשיך
          מכל מכשיר. "לא רלוונטי" מסמן שאין מה לענות.
        </p>
      </section>

      {/* טופ 10 */}
      <details className="bg-[var(--panel)] border border-amber-500/40 rounded-2xl p-4">
        <summary className="font-semibold cursor-pointer text-sm">🔥 הטופ 10 הדחוף - כדאי להתחיל כאן</summary>
        <p className="mt-2 text-[11px] text-[var(--muted)]">
          אלה עשרת הנושאים הבוערים לפי תדירות ונזק - לא עונים עליהם כאן: השאלות עצמן מחכות בקטגוריות
          שלמטה (מסומנות ⭐). פתחו קטגוריה, כתבו תשובה - והיא נשמרת לבד.
        </p>
        <ol className="mt-2 space-y-1 text-xs text-[var(--muted)] list-decimal pr-5">
          {TOP10.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ol>
      </details>

      {/* קטגוריות */}
      {QUIZ.map((cat, ci) => {
        const qs = starredOnly ? cat.questions.filter((q) => q.starred) : cat.questions;
        if (!qs.length) return null;
        const catDone = cat.questions.filter((q) => answers[q.id]?.answer || answers[q.id]?.skipped).length;
        const open = openCat === ci;
        return (
          <section key={ci} className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl overflow-hidden">
            <button
              onClick={() => setOpenCat(open ? null : ci)}
              className="w-full flex items-center justify-between gap-2 p-4 text-right"
              aria-expanded={open}
            >
              <span className="font-semibold text-sm">{cat.name}</span>
              <span
                className={`text-xs rounded-full px-2 py-0.5 ${catDone === cat.questions.length ? "bg-emerald-500/15 text-emerald-400" : "bg-[var(--panel2)] text-[var(--muted)]"}`}
              >
                {catDone}/{cat.questions.length}
              </span>
            </button>
            {open && (
              <div className="px-4 pb-4 space-y-4">
                {qs.map((q) => {
                  const a = answers[q.id];
                  const val = drafts[q.id] ?? a?.answer ?? "";
                  return (
                    <div key={q.id} className={`space-y-1.5 ${a?.skipped ? "opacity-60" : ""}`}>
                      <div className="text-sm leading-relaxed">
                        {q.starred && <span title="לקוחות שאלו בפועל">⭐ </span>}
                        {q.text}
                      </div>
                      {q.source && <div className="text-[11px] text-[var(--muted)]">💬 לקוח: {q.source}</div>}
                      <div className="flex gap-2 items-start">
                        <textarea
                          value={val}
                          onChange={(e) => onType(q.id, e.target.value)}
                          placeholder={a?.skipped ? "סומן כלא רלוונטי" : "התשובה שלך…"}
                          rows={val.length > 80 ? 3 : 1}
                          className="flex-1 min-w-0 bg-[var(--panel2)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm outline-none focus:border-[var(--accent)] resize-y"
                        />
                        <button
                          onClick={() => save(q.id, { skipped: !a?.skipped })}
                          title="אין מה לענות / לא רלוונטי לעסק"
                          className={`shrink-0 text-[11px] rounded-lg px-2 min-h-9 border ${a?.skipped ? "bg-neutral-500/15 border-neutral-500/40" : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"}`}
                        >
                          לא רלוונטי
                        </button>
                      </div>
                      {a?.answer && !drafts[q.id] && (
                        <div className="text-[10px] text-emerald-400">✓ נשמר{a.by ? ` (${a.by})` : ""}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
