"use client";

import { useEffect, useRef, useState } from "react";

interface Msg {
  role: "user" | "bot";
  text: string;
  media?: { url: string; type: "image" | "video" }[];
}

export default function TestChat({
  prefill,
  onPrefillConsumed,
}: {
  prefill?: string | null;
  onPrefillConsumed?: () => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [convId, setConvId] = useState<string | undefined>();
  const [clientId, setClientId] = useState(() => "admin-test-" + Math.random().toString(36).slice(2, 8));
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // שאלה שהגיעה ממסך הידע ("בדוק בבוט") - ממלאים את השדה ומחכים לשליחה ידנית
  useEffect(() => {
    if (!prefill) return;
    setInput(prefill);
    onPrefillConsumed?.();
    inputRef.current?.focus();
  }, [prefill, onPrefillConsumed]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [msgs]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", text }]);
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, conversationId: convId, clientId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // שגיאה אמיתית מהשרת - לא מציגים "הצלחה" כוזבת
        setMsgs((m) => [...m, { role: "bot", text: `⚠ הבוט נכשל (${res.status}): ${data.error || "שגיאת שרת"}` }]);
        return;
      }
      setConvId(data.conversationId);
      if (data.reply) setMsgs((m) => [...m, { role: "bot", text: data.reply, media: data.media }]);
      else setMsgs((m) => [...m, { role: "bot", text: "(הבוט לא החזיר תשובה - ייתכן שהוא מושהה או כבוי)" }]);
    } catch {
      setMsgs((m) => [...m, { role: "bot", text: "⚠ אין חיבור לשרת - הבדיקה לא נשלחה" }]);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setMsgs([]);
    setConvId(undefined);
    // session חדש לגמרי - גם לקוח בדיקה חדש, כדי שהזיכרון לא ידלוף בין בדיקות
    setClientId("admin-test-" + Math.random().toString(36).slice(2, 8));
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className="font-semibold">בדיקת בוט</h2>
          <p className="text-xs text-[var(--muted)]">דבר עם הבוט בדיוק כמו לקוח, כדי לבדוק עריכות (שעות, מחירים, מדיה) לפני שהן באוויר.</p>
        </div>
        <button onClick={reset} className="text-xs text-[var(--muted)] hover:text-[var(--text)] border border-[var(--border)] rounded-lg px-2.5 py-1.5">
          שיחה חדשה
        </button>
      </div>

      <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl flex flex-col h-[calc(100dvh-230px)] md:h-[calc(100dvh-180px)]">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
          {msgs.length === 0 && <div className="text-center text-sm text-[var(--muted)] mt-10">שלח הודעה כדי להתחיל לבדוק 👇</div>}
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.role === "bot" ? "justify-start" : "justify-end"}`}>
              <div className="max-w-[80%] space-y-1">
                <div dir="auto" className={`rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${m.role === "user" ? "bg-[var(--accent)] text-[var(--accent-fg)]" : m.text.startsWith("⚠") ? "bg-red-500/15 text-red-300 border border-red-500/25" : "bg-[var(--panel2)] text-[var(--text)]"}`}>
                  {m.text}
                </div>
                {m.media?.map((md, j) =>
                  md.type === "video" ? (
                    <video key={j} src={md.url} controls className="rounded-xl max-w-full" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={j} src={md.url} alt="" className="rounded-xl max-w-full" />
                  )
                )}
              </div>
            </div>
          ))}
          {busy && <div className="text-xs text-[var(--muted)]">הבוט כותב…</div>}
        </div>
        <div className="border-t border-[var(--border)] p-2.5 flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="כתוב הודעת בדיקה…"
            className="flex-1 bg-[var(--panel2)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />
          <button onClick={send} disabled={busy || !input.trim()} className="bg-[var(--accent)] text-[var(--accent-fg)] font-semibold rounded-xl px-4 text-sm disabled:opacity-40">
            שלח
          </button>
        </div>
      </div>
    </div>
  );
}
