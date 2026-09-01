"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "./types";

/**
 * מעבדת טאביט - צ'אט AI מבודד לבדיקת החיבורים לטאביט (מנהל בלבד).
 * מבודד לגמרי מהצ'אטבוט הציבורי. כל קריאה/יצירה מבוצעת ע"י הסוכן המקומי,
 * ולוג הכלים מציג בדיוק מה רץ, מה חזר, ומה נכשל.
 */

interface ToolEntry {
  tool: string;
  params: unknown;
  ok: boolean;
  result?: unknown;
  error?: string;
}
interface Msg {
  role: "user" | "assistant";
  text: string;
  tools?: ToolEntry[];
}

const SUGGESTIONS = [
  "בדוק חיבור לטאביט",
  "מה ההזמנות הגדולות מחר?",
  "למי חסר פיקדון מחר?",
  "צור הזמנת בדיקה על השם שלי מחר ב-20:00 ל-2 אנשים",
];

function ToolLog({ tools }: { tools: ToolEntry[] }) {
  const [open, setOpen] = useState(false);
  if (!tools.length) return null;
  return (
    <div className="mt-1.5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-[11px] text-[var(--muted)] hover:text-[var(--text)] border border-[var(--border)] rounded-lg px-2 py-0.5"
      >
        🔧 {tools.length} פעולות טאביט {open ? "▲" : "▼"}
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5">
          {tools.map((t, i) => (
            <div key={i} className={`rounded-lg border px-2.5 py-1.5 text-[11px] ${t.ok ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"}`}>
              <div className="flex items-center gap-1.5 font-mono">
                <span>{t.ok ? "✓" : "✗"}</span>
                <b>{t.tool}</b>
                <span className="text-[var(--muted)] truncate" dir="ltr">{JSON.stringify(t.params)}</span>
              </div>
              <pre dir="ltr" className="mt-1 whitespace-pre-wrap break-words text-[10px] text-[var(--muted)] max-h-40 overflow-auto">
                {t.ok ? JSON.stringify(t.result, null, 2) : t.error}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TabitTestChat({ token }: { token: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [msgs]);

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    setInput("");
    const next = [...msgs, { role: "user" as const, text: content }];
    setMsgs(next);
    setBusy(true);
    try {
      const payload = next.map((m) => ({ role: m.role, content: m.text }));
      const data = await api<{ reply: string; toolLog: ToolEntry[] }>(token, "/tabit/testchat", {
        method: "POST",
        body: JSON.stringify({ messages: payload }),
      });
      setMsgs((m) => [...m, { role: "assistant", text: data.reply, tools: data.toolLog || [] }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", text: `⚠ ${e instanceof Error ? e.message : "שגיאה"}`, tools: [] }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-[var(--muted)]">
          צ'אט מבודד לבדיקת טאביט - קורא ויוצר הזמנות דרך הסוכן המקומי. לא נוגע בהזמנות קיימות ולא קשור לבוט הציבורי.
        </p>
        <button
          onClick={() => setMsgs([])}
          className="shrink-0 text-xs text-[var(--muted)] hover:text-[var(--text)] border border-[var(--border)] rounded-lg px-2.5 py-1.5"
        >
          שיחה חדשה
        </button>
      </div>

      <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl flex flex-col h-[calc(100dvh-250px)] md:h-[calc(100dvh-200px)]">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
          {msgs.length === 0 && (
            <div className="text-center text-sm text-[var(--muted)] mt-8 space-y-3">
              <div>שלח הודעה כדי לבדוק את החיבור לטאביט 👇</div>
              <div className="flex flex-wrap gap-2 justify-center">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => send(s)} className="text-xs border border-[var(--border)] rounded-full px-3 py-1.5 hover:border-[var(--accent)] hover:text-[var(--accent)]">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.role === "assistant" ? "justify-start" : "justify-end"}`}>
              <div className="max-w-[85%]">
                <div dir="auto" className={`rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${m.role === "user" ? "bg-[var(--accent)] text-[var(--accent-fg)]" : m.text.startsWith("⚠") ? "bg-red-500/15 text-red-300 border border-red-500/25" : "bg-[var(--panel2)] text-[var(--text)]"}`}>
                  {m.text}
                </div>
                {m.role === "assistant" && m.tools && <ToolLog tools={m.tools} />}
              </div>
            </div>
          ))}
          {busy && <div className="text-xs text-[var(--muted)]">מריץ מול טאביט…</div>}
        </div>
        <div className="border-t border-[var(--border)] p-2.5 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="כתוב הודעה… (למשל: מה ההזמנות מחר?)"
            className="flex-1 bg-[var(--panel2)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />
          <button onClick={() => send()} disabled={busy || !input.trim()} className="bg-[var(--accent)] text-[var(--accent-fg)] font-semibold rounded-xl px-4 text-sm disabled:opacity-40">
            שלח
          </button>
        </div>
      </div>
    </div>
  );
}
