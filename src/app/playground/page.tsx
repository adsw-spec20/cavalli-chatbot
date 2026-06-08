"use client";

/**
 * Playground — ממשק צ'אט לבדיקת הבוט בלי מטא.
 * מדמה שיחת וואטסאפ ומדבר עם אותו מוח (/api/chat) שישרת את הערוצים האמיתיים.
 */

import { useState, useRef, useEffect } from "react";
import type { ConversationMessage } from "@/lib/channels/types";

export default function Playground() {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const conversationId = useRef<string | undefined>(undefined);
  const clientId = useRef<string>("");

  // מזהה דפדפן יציב (כדי לדמות "לקוח חוזר") + מזהה שיחה שנוצר מראש (לטיפול ברצף)
  useEffect(() => {
    let id = localStorage.getItem("cavalli_client_id");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("cavalli_client_id", id);
    }
    clientId.current = id;
    if (!conversationId.current) conversationId.current = crypto.randomUUID();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending]);

  function resetConversation() {
    conversationId.current = crypto.randomUUID();
    setMessages([]);
    setError(null);
  }

  // אפשר לשלוח גם בזמן שהבוט "מקליד" (כמו בפלטפורמות אמיתיות). השרת מטפל ברצף
  // ההודעות: ההודעה האחרונה מנצחת, ותשובות שהוחלפו חוזרות כ-null ומתעלמים מהן.
  async function send() {
    const text = input.trim();
    if (!text) return;

    setError(null);
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setPending((p) => p + 1);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          conversationId: conversationId.current,
          clientId: clientId.current,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה בשרת");
      conversationId.current = data.conversationId;
      if (data.reply) {
        setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
      } else if (data.status === "human") {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "(נציג אנושי יענה לך בקרוב 🙋)" },
        ]);
      }
      // reply=null עם status=bot => ההודעה הוחלפה ע"י חדשה יותר, לא מציגים כלום
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה לא ידועה");
    } finally {
      setPending((p) => p - 1);
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center bg-neutral-950">
      <div className="w-full max-w-2xl flex flex-col h-screen">
        <header className="px-4 py-3 border-b border-neutral-800 bg-neutral-900 flex items-center justify-between gap-3">
          <div>
            <h1 className="font-semibold">Playground — בדיקת הבוט 🤖</h1>
            <p className="text-xs text-neutral-500">
              אותו מוח בדיוק שישרת את וואטסאפ. השיחה נשמרת בשרת.
            </p>
          </div>
          <button
            onClick={resetConversation}
            className="text-xs bg-neutral-800 hover:bg-neutral-700 transition-colors px-3 py-1.5 rounded-lg shrink-0"
          >
            שיחה חדשה
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <div className="text-center text-neutral-600 mt-10 text-sm">
              שלח הודעה כדי להתחיל — נסה "מה שעות הפעילות?" או "כמה עולה תספורת?"
            </div>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex ${
                m.role === "user" ? "justify-start" : "justify-end"
              }`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap ${
                  m.role === "user"
                    ? "bg-neutral-800 text-neutral-100"
                    : "bg-emerald-700 text-white"
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}
          {pending > 0 && (
            <div className="flex justify-end">
              <div className="bg-emerald-700/50 rounded-2xl px-4 py-2 text-sm flex gap-1 items-center">
                <span className="w-1.5 h-1.5 bg-white/70 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 bg-white/70 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 bg-white/70 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          )}
          {error && (
            <div className="text-center text-red-400 text-sm">⚠️ {error}</div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="p-3 border-t border-neutral-800 bg-neutral-900 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="כתוב הודעה ללקוח…"
            className="flex-1 bg-neutral-800 rounded-lg px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-600"
          />
          <button
            onClick={send}
            className="bg-emerald-600 hover:bg-emerald-500 transition-colors px-5 py-2 rounded-lg text-sm font-semibold"
          >
            שלח
          </button>
        </div>
      </div>
    </main>
  );
}
