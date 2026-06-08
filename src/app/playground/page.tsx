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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const conversationId = useRef<string | undefined>(undefined);
  const clientId = useRef<string>("");

  // מזהה דפדפן יציב (כדי לדמות "לקוח חוזר") + מזהה שיחה מתמשך
  useEffect(() => {
    let id = localStorage.getItem("cavalli_client_id");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("cavalli_client_id", id);
    }
    clientId.current = id;
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function resetConversation() {
    conversationId.current = undefined;
    setMessages([]);
    setError(null);
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    setError(null);
    const newHistory: ConversationMessage[] = [
      ...messages,
      { role: "user", content: text },
    ];
    setMessages(newHistory);
    setInput("");
    setLoading(true);

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
        setMessages([...newHistory, { role: "assistant", content: data.reply }]);
      } else {
        // נציג אנושי השתלט על השיחה - הבוט שותק
        setMessages([
          ...newHistory,
          { role: "assistant", content: "(נציג אנושי יענה לך בקרוב 🙋)" },
        ]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה לא ידועה");
    } finally {
      setLoading(false);
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
          {loading && (
            <div className="flex justify-end">
              <div className="bg-emerald-700/50 rounded-2xl px-4 py-2 text-sm">
                מקליד…
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
            disabled={loading}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 transition-colors px-5 py-2 rounded-lg text-sm font-semibold"
          >
            שלח
          </button>
        </div>
      </div>
    </main>
  );
}
