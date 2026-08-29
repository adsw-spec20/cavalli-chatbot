"use client";

/**
 * "שאלות לצוות" - אשף מענה נוח על הרשימה שאדיר הכין (29.8).
 *
 * העיקרון: שאלה אחת על המסך (לא רשימה מלחיצה), עם שמור-והבא / דלג / חזור,
 * ומסך "מבט על" שמראה את כל השאלות לפי נושא עם מצב (נענתה/דולגה/פתוחה)
 * ומאפשר לקפוץ לכל שאלה. כל תשובה נשמרת מיד בשרת עם שם העונה.
 * ההטמעה לבוט נעשית בנפרד, אחרי בדיקת סתירות - לא אוטומטית.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./types";
import { TEAM_QUESTIONS, TEAM_QUESTIONS_TOTAL, type TeamQuestion } from "./team-questions-data";

interface TQAnswer {
  answer?: string;
  skipped?: boolean;
  ts: number;
  by?: string;
}

/** רשימה שטוחה עם שם הקבוצה ליד כל שאלה - נוח גם לאשף וגם למבט-על */
const FLAT: Array<TeamQuestion & { group: string; emoji: string }> = TEAM_QUESTIONS.flatMap((g) =>
  g.questions.map((q) => ({ ...q, group: g.name, emoji: g.emoji }))
);

export default function TeamQuestions({
  token,
  agentName,
}: {
  token: string;
  agentName: string;
}) {
  const [answers, setAnswers] = useState<Record<string, TQAnswer>>({});
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<"wizard" | "overview">("wizard");
  const [idx, setIdx] = useState(0);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api<Record<string, TQAnswer>>(token, "/team-questions")
      .then((a) => {
        setAnswers(a);
        // מתחילים מהשאלה הפתוחה הראשונה; אם הכל נענה - מבט על
        const firstOpen = FLAT.findIndex((q) => !a[q.id]?.answer && !a[q.id]?.skipped);
        if (firstOpen === -1) setMode("overview");
        else setIdx(firstOpen);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [token]);

  const q = FLAT[idx];
  // הטיוטה מתעדכנת כשעוברים שאלה (עריכת תשובה קיימת מציגה אותה)
  useEffect(() => {
    setDraft(answers[q?.id]?.answer ?? "");
  }, [idx, q?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const doneCount = useMemo(
    () => FLAT.filter((x) => answers[x.id]?.answer).length,
    [answers]
  );
  const skippedCount = useMemo(
    () => FLAT.filter((x) => answers[x.id]?.skipped && !answers[x.id]?.answer).length,
    [answers]
  );

  async function persist(id: string, payload: { answer?: string; skipped?: boolean }) {
    setSaving(true);
    try {
      await api(token, "/team-questions", {
        method: "POST",
        body: JSON.stringify({ id, ...payload, by: agentName || undefined }),
      });
      setAnswers((prev) => {
        const next = { ...prev };
        if (!payload.answer && !payload.skipped) delete next[id];
        else next[id] = { answer: payload.answer, skipped: payload.skipped, ts: Date.now(), by: agentName };
        return next;
      });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1200);
      return true;
    } catch {
      alert("השמירה נכשלה - בדקו חיבור ונסו שוב");
      return false;
    } finally {
      setSaving(false);
    }
  }

  function advance() {
    // לשאלה הפתוחה הבאה אחרי הנוכחית; אם אין - מבט על
    for (let i = idx + 1; i < FLAT.length; i++) {
      const a = answers[FLAT[i].id];
      if (!a?.answer && !a?.skipped) {
        setIdx(i);
        return;
      }
    }
    if (idx + 1 < FLAT.length) setIdx(idx + 1);
    else setMode("overview");
  }

  async function saveAndNext() {
    if (!draft.trim()) return;
    if (await persist(q.id, { answer: draft.trim() })) advance();
  }

  async function skip() {
    if (await persist(q.id, { skipped: true })) advance();
  }

  function back() {
    if (idx > 0) setIdx(idx - 1);
  }

  if (!loaded) return <div className="text-sm text-[var(--muted)] p-6">טוען…</div>;

  // ---------- מבט על ----------
  if (mode === "overview") {
    const firstOpen = FLAT.findIndex((x) => !answers[x.id]?.answer && !answers[x.id]?.skipped);
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-4 flex items-center justify-between flex-wrap gap-2">
          <div className="text-sm">
            <span className="font-semibold">{doneCount}</span> נענו ·{" "}
            <span className="font-semibold">{skippedCount}</span> דולגו ·{" "}
            <span className="font-semibold">{TEAM_QUESTIONS_TOTAL - doneCount - skippedCount}</span> פתוחות
          </div>
          {firstOpen !== -1 && (
            <button
              onClick={() => {
                setIdx(firstOpen);
                setMode("wizard");
              }}
              className="bg-[var(--accent)] text-[var(--accent-fg)] font-semibold rounded-xl px-4 py-2 text-sm"
            >
              המשך מאיפה שעצרתי ←
            </button>
          )}
        </div>

        {TEAM_QUESTIONS.map((g) => (
          <div key={g.name} className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-4">
            <h3 className="font-semibold text-sm mb-2">
              {g.emoji} {g.name}
            </h3>
            <div className="space-y-1">
              {g.questions.map((x) => {
                const a = answers[x.id];
                const state = a?.answer ? "done" : a?.skipped ? "skipped" : "open";
                return (
                  <button
                    key={x.id}
                    onClick={() => {
                      setIdx(FLAT.findIndex((f) => f.id === x.id));
                      setMode("wizard");
                    }}
                    className="w-full text-right flex items-start gap-2 rounded-xl px-2 py-2 hover:bg-[var(--panel2)] transition"
                  >
                    <span
                      className={`mt-1 shrink-0 w-2.5 h-2.5 rounded-full ${
                        state === "done"
                          ? "bg-emerald-500"
                          : state === "skipped"
                            ? "bg-neutral-400"
                            : "bg-amber-400"
                      }`}
                    />
                    <span className="min-w-0">
                      <span className="text-sm block">{x.text}</span>
                      {a?.answer && (
                        <span className="text-xs text-[var(--muted)] block truncate">✓ {a.answer}</span>
                      )}
                      {state === "skipped" && (
                        <span className="text-xs text-[var(--muted)]">דולגה - אפשר לחזור אליה</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ---------- אשף: שאלה אחת על המסך ----------
  // מובייל (עוצב מחדש 29.8 אחרי פידבק): כותרת דקה, כפתורים דביקים בתחתית
  // שנשארים גלויים מעל המקלדת, וגלילה אוטומטית לשדה כשמתחילים להקליד.
  const progress = Math.round(((doneCount + skippedCount) / TEAM_QUESTIONS_TOTAL) * 100);
  const existing = answers[q.id];

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-3">
      {/* שורת התקדמות דקה */}
      <div className="bg-[var(--panel)] border border-[var(--border)] rounded-xl px-3 py-2">
        <div className="flex items-center justify-between text-xs text-[var(--muted)]">
          <span className="truncate">
            {idx + 1}/{TEAM_QUESTIONS_TOTAL} · {q.emoji} {q.group}
          </span>
          <button
            onClick={() => setMode("overview")}
            className="shrink-0 underline hover:text-[var(--text)] mr-2"
          >
            מבט על
          </button>
        </div>
        <div className="h-1.5 rounded-full bg-[var(--panel2)] overflow-hidden mt-1.5">
          <div className="h-full bg-[var(--accent)] transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* השאלה */}
      <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-4 md:p-5 space-y-2.5">
        {q.task && (
          <span className="inline-block text-[11px] bg-purple-500/15 text-purple-300 rounded-full px-2 py-0.5 font-semibold">
            📋 משימה לביצוע
          </span>
        )}
        <h2 className="text-base md:text-lg font-semibold leading-snug">{q.text}</h2>
        {q.note && <p className="text-xs text-[var(--muted)]">{q.note}</p>}
        {existing?.answer && (
          <p className="text-xs text-emerald-400">✓ כבר נענתה - אפשר לערוך את התשובה</p>
        )}

        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => {
            // אחרי שאנימציית המקלדת נגמרת - מוודאים שהשדה והכפתורים באזור הנראה
            setTimeout(() => {
              textareaRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
            }, 350);
          }}
          rows={4}
          placeholder={q.task ? "מה בוצע / מה סוכם…" : "התשובה שלך…"}
          className="w-full bg-[var(--panel2)] border border-[var(--border)] rounded-xl px-3 py-2.5 outline-none focus:border-[var(--accent)] resize-none"
          style={{ fontSize: 16 }}
        />
      </div>

      {/* כפתורי הפעולה - דביקים לתחתית אזור הגלילה: תמיד נראים, גם כשהמקלדת פתוחה */}
      <div className="sticky bottom-0 bg-[var(--bg)] border-t border-[var(--border)] -mx-3 px-3 py-2.5 md:static md:bg-transparent md:border-0 md:m-0 md:p-0">
        <div className="flex items-center gap-2">
          <button
            onClick={saveAndNext}
            disabled={saving || !draft.trim()}
            className="flex-1 md:flex-none bg-[var(--accent)] text-[var(--accent-fg)] font-semibold rounded-xl px-5 min-h-11 text-sm disabled:opacity-40"
          >
            {saving ? "שומר…" : "שמור והבא ←"}
          </button>
          <button
            onClick={skip}
            disabled={saving}
            className="border border-[var(--border)] rounded-xl px-4 min-h-11 text-sm hover:bg-[var(--panel2)] disabled:opacity-40"
          >
            דלג
          </button>
          <button
            onClick={back}
            disabled={idx === 0}
            className="text-sm text-[var(--muted)] rounded-xl px-2.5 min-h-11 hover:text-[var(--text)] disabled:opacity-30"
          >
            → חזור
          </button>
          {savedFlash && <span className="text-xs text-emerald-400 shrink-0">נשמר ✓</span>}
        </div>
      </div>

      <p className="hidden md:block text-[11px] text-[var(--muted)] text-center">
        כל תשובה נשמרת מיד. אפשר לצאת ולחזור מתי שנוח - ממשיכים מאותה נקודה.
      </p>
    </div>
  );
}
