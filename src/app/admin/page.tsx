"use client";

/**
 * פאנל ניהול: אנליטיקה + אינבוקס שיחות חי.
 * נציג יכול לראות שיחות, להשתלט (הבוט שותק), לענות, ולשחרר חזרה לבוט.
 */

import { useCallback, useEffect, useRef, useState } from "react";

interface Stats {
  totalConversations: number;
  byStatus: { bot: number; human: number; closed: number };
  escalated: number;
  deflectionRate: number;
  totalUserMessages: number;
  last7Days: { date: string; count: number }[];
  topWords: { word: string; count: number }[];
  needsAttention: number;
  openQuestions: number;
}

interface LearnedQA {
  id: string;
  question: string;
  answer: string | null;
  status: string;
  createdAt: number;
}

interface ConvItem {
  id: string;
  channel: string;
  status: string;
  escalated?: boolean;
  escalationReason?: string;
  customerId: string;
  updatedAt: number;
  lastMessage?: string;
  messageCount: number;
}

interface Detail {
  conversation: {
    id: string;
    status: string;
    channel: string;
    escalationReason?: string;
    escalationSummary?: string;
  };
  customer: { id: string; channelUserId: string; vip?: boolean } | null;
  messages: { id: string; role: string; content: string; ts: number }[];
}

const STATUS_LABEL: Record<string, string> = {
  bot: "🤖 בוט",
  human: "🙋 נציג",
  closed: "✓ סגורה",
};

export default function Admin() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [convs, setConvs] = useState<ConvItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [reply, setReply] = useState("");
  const [token, setToken] = useState("");
  const [openQA, setOpenQA] = useState<LearnedQA[]>([]);
  const [answeredQA, setAnsweredQA] = useState<LearnedQA[]>([]);
  const [qaAnswers, setQaAnswers] = useState<Record<string, string>>({});
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;

  const authHeaders = useCallback(
    (): Record<string, string> => (token ? { "x-admin-token": token } : {}),
    [token]
  );

  useEffect(() => {
    const saved = localStorage.getItem("admin_token");
    if (saved) setToken(saved);
  }, []);

  const fetchAll = useCallback(async () => {
    try {
      const [s, c, open, answered] = await Promise.all([
        fetch("/api/admin/stats", { headers: authHeaders() }).then((r) => r.json()),
        fetch("/api/admin/conversations", { headers: authHeaders() }).then((r) => r.json()),
        fetch("/api/admin/knowledge?status=open", { headers: authHeaders() }).then((r) => r.json()),
        fetch("/api/admin/knowledge?status=answered", { headers: authHeaders() }).then((r) => r.json()),
      ]);
      if (!s.error) setStats(s);
      if (Array.isArray(c)) setConvs(c);
      if (Array.isArray(open)) setOpenQA(open);
      if (Array.isArray(answered)) setAnsweredQA(answered);
    } catch {
      /* ignore transient */
    }
  }, [authHeaders]);

  async function knowledgeAction(id: string, body: object) {
    await fetch(`/api/admin/knowledge/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    });
    setQaAnswers((p) => {
      const n = { ...p };
      delete n[id];
      return n;
    });
    await fetchAll();
  }

  const fetchDetail = useCallback(
    async (id: string) => {
      const d = await fetch(`/api/admin/conversations/${id}`, {
        headers: authHeaders(),
      }).then((r) => r.json());
      if (!d.error) setDetail(d);
    },
    [authHeaders]
  );

  useEffect(() => {
    fetchAll();
    const t = setInterval(() => {
      fetchAll();
      if (selectedRef.current) fetchDetail(selectedRef.current);
    }, 4000);
    return () => clearInterval(t);
  }, [fetchAll, fetchDetail]);

  useEffect(() => {
    if (selectedId) fetchDetail(selectedId);
  }, [selectedId, fetchDetail]);

  async function doAction(action: string, text?: string) {
    if (!selectedId) return;
    await fetch(`/api/admin/conversations/${selectedId}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ action, text }),
    });
    setReply("");
    await fetchDetail(selectedId);
    await fetchAll();
  }

  // התראות לנציג: כשמספר השיחות הממתינות עולה, התראת דפדפן + תג בכותרת הטאב
  const prevWaiting = useRef(0);
  useEffect(() => {
    const waiting = stats?.needsAttention ?? 0;
    document.title = waiting > 0 ? `(${waiting}) ממתינות - ניהול קוואלי` : "ניהול קוואלי";
    if (waiting > prevWaiting.current) {
      if ("Notification" in window) {
        if (Notification.permission === "granted") {
          new Notification("שיחה ממתינה לנציג 🙋", {
            body: "לקוח מחכה לטיפול אנושי בקפה קוואלי",
          });
        } else if (Notification.permission !== "denied") {
          Notification.requestPermission();
        }
      }
    }
    prevWaiting.current = waiting;
  }, [stats?.needsAttention]);

  const maxDay = Math.max(1, ...(stats?.last7Days.map((d) => d.count) ?? [1]));

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 p-4">
      <div className="max-w-6xl mx-auto">
        <header className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">פאנל ניהול - קפה קוואלי</h1>
          <input
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              localStorage.setItem("admin_token", e.target.value);
            }}
            placeholder="ADMIN_TOKEN (אם הוגדר)"
            className="bg-neutral-800 text-xs rounded px-2 py-1 w-48 outline-none"
          />
        </header>

        {/* כרטיסי סטטיסטיקה */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
            <Card label="שיחות סה״כ" value={stats.totalConversations} />
            <Card
              label="% הכלה (בוט סגר)"
              value={`${stats.deflectionRate}%`}
              accent="emerald"
            />
            <Card
              label="ממתינות לנציג"
              value={stats.needsAttention}
              accent={stats.needsAttention > 0 ? "amber" : undefined}
            />
            <Card
              label="שאלות ללא מענה"
              value={stats.openQuestions}
              accent={stats.openQuestions > 0 ? "amber" : undefined}
            />
            <Card label="הסלמות" value={stats.escalated} />
            <Card label="הודעות לקוחות" value={stats.totalUserMessages} />
          </div>
        )}

        {/* גרף 7 ימים + מילים נפוצות */}
        {stats && (
          <div className="grid md:grid-cols-2 gap-3 mb-4">
            <div className="bg-neutral-900 rounded-xl p-3">
              <div className="text-xs text-neutral-400 mb-2">שיחות ב-7 הימים האחרונים</div>
              <div className="flex items-end gap-1 h-20">
                {stats.last7Days.map((d) => (
                  <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
                    <div
                      className="w-full bg-emerald-600 rounded-t"
                      style={{ height: `${(d.count / maxDay) * 100}%`, minHeight: d.count ? 4 : 0 }}
                      title={`${d.date}: ${d.count}`}
                    />
                    <span className="text-[9px] text-neutral-500">{d.date.slice(5)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-neutral-900 rounded-xl p-3">
              <div className="text-xs text-neutral-400 mb-2">מה הלקוחות הכי שואלים</div>
              <div className="flex flex-wrap gap-1.5">
                {stats.topWords.map((w) => (
                  <span
                    key={w.word}
                    className="text-xs bg-neutral-800 rounded-full px-2 py-0.5"
                  >
                    {w.word} <span className="text-neutral-500">{w.count}</span>
                  </span>
                ))}
                {stats.topWords.length === 0 && (
                  <span className="text-xs text-neutral-600">עוד אין מספיק נתונים</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ידע נלמד: שאלות שהבוט לא ידע, ותשובות שהופכות לידע */}
        <div className="bg-neutral-900 rounded-xl p-3 mb-4">
          <div className="text-sm font-semibold mb-2">
            🧠 ידע הבוט - שאלות שצריך לענות עליהן
          </div>
          {openQA.length === 0 && (
            <div className="text-xs text-neutral-600 mb-2">
              אין כרגע שאלות פתוחות. כשהבוט ייתקל בשאלה שאין לו תשובה עליה, היא תופיע כאן.
            </div>
          )}
          <div className="space-y-2">
            {openQA.map((q) => (
              <div
                key={q.id}
                className="bg-neutral-800 rounded-lg p-2.5 flex flex-col gap-2"
              >
                <div className="text-sm">
                  <span className="text-amber-400">שאלה:</span> {q.question}
                </div>
                <div className="flex gap-2">
                  <input
                    value={qaAnswers[q.id] ?? ""}
                    onChange={(e) =>
                      setQaAnswers((p) => ({ ...p, [q.id]: e.target.value }))
                    }
                    onKeyDown={(e) =>
                      e.key === "Enter" &&
                      qaAnswers[q.id]?.trim() &&
                      knowledgeAction(q.id, { answer: qaAnswers[q.id].trim() })
                    }
                    placeholder="כתוב את התשובה, והבוט ילמד אותה…"
                    className="flex-1 bg-neutral-900 rounded px-2 py-1.5 text-sm outline-none"
                  />
                  <button
                    onClick={() =>
                      qaAnswers[q.id]?.trim() &&
                      knowledgeAction(q.id, { answer: qaAnswers[q.id].trim() })
                    }
                    className="text-xs bg-emerald-600 hover:bg-emerald-500 rounded px-3 py-1.5 font-semibold"
                  >
                    שמור ולמד
                  </button>
                  <button
                    onClick={() => knowledgeAction(q.id, { action: "delete" })}
                    className="text-xs bg-neutral-700 hover:bg-neutral-600 rounded px-2 py-1.5"
                  >
                    התעלם
                  </button>
                </div>
              </div>
            ))}
          </div>

          {answeredQA.length > 0 && (
            <details className="mt-3">
              <summary className="text-xs text-neutral-400 cursor-pointer">
                ידע שנלמד ({answeredQA.length})
              </summary>
              <div className="space-y-1.5 mt-2">
                {answeredQA.map((q) => (
                  <div
                    key={q.id}
                    className="text-xs bg-neutral-800/60 rounded p-2 flex items-start justify-between gap-2"
                  >
                    <div>
                      <span className="text-emerald-400">שאלה:</span> {q.question}
                      <br />
                      <span className="text-neutral-400">תשובה:</span> {q.answer}
                    </div>
                    <button
                      onClick={() => knowledgeAction(q.id, { action: "delete" })}
                      className="text-neutral-500 hover:text-red-400 shrink-0"
                      title="מחק"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>

        {/* אינבוקס: רשימה + שיחה */}
        <div className="grid md:grid-cols-[320px_1fr] gap-3">
          {/* רשימת שיחות */}
          <div className="bg-neutral-900 rounded-xl overflow-hidden max-h-[60vh] overflow-y-auto">
            {convs.length === 0 && (
              <div className="text-sm text-neutral-600 p-4 text-center">אין שיחות עדיין</div>
            )}
            {convs.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={`w-full text-right p-3 border-b border-neutral-800 hover:bg-neutral-800 transition-colors ${
                  selectedId === c.id ? "bg-neutral-800" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs">{STATUS_LABEL[c.status] ?? c.status}</span>
                  {c.escalated && (
                    <span className="text-[10px] bg-amber-600/80 rounded px-1.5 py-0.5">
                      הסלמה
                    </span>
                  )}
                </div>
                <div className="text-sm text-neutral-300 truncate mt-1">
                  {c.lastMessage || "(אין הודעות)"}
                </div>
                <div className="text-[10px] text-neutral-500 mt-1">
                  {c.channel} · {c.messageCount} הודעות
                </div>
              </button>
            ))}
          </div>

          {/* שיחה נבחרת */}
          <div className="bg-neutral-900 rounded-xl flex flex-col max-h-[60vh]">
            {!detail && (
              <div className="text-sm text-neutral-600 p-6 text-center">
                בחר שיחה כדי לצפות ולהשתלט
              </div>
            )}
            {detail && (
              <>
                <div className="p-3 border-b border-neutral-800 flex flex-col gap-2">
                 <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-xs text-neutral-400">
                    {detail.conversation.channel} · {STATUS_LABEL[detail.conversation.status]}
                    {detail.conversation.escalationReason && (
                      <span className="text-amber-400"> · {detail.conversation.escalationReason}</span>
                    )}
                  </div>
                  <div className="flex gap-1.5">
                    {detail.conversation.status !== "human" && (
                      <button onClick={() => doAction("takeover")} className="text-xs bg-amber-600 hover:bg-amber-500 rounded px-2 py-1">
                        השתלט
                      </button>
                    )}
                    {detail.conversation.status === "human" && (
                      <button onClick={() => doAction("release")} className="text-xs bg-emerald-600 hover:bg-emerald-500 rounded px-2 py-1">
                        החזר לבוט
                      </button>
                    )}
                    <button onClick={() => doAction("close")} className="text-xs bg-neutral-700 hover:bg-neutral-600 rounded px-2 py-1">
                      סגור
                    </button>
                  </div>
                 </div>
                 {detail.conversation.escalationSummary && (
                   <div className="text-xs bg-amber-950/60 border border-amber-800/50 rounded-lg p-2 text-amber-200">
                     <span className="font-semibold">📋 סיכום לנציג:</span>{" "}
                     {detail.conversation.escalationSummary}
                   </div>
                 )}
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {detail.messages
                    .filter((m) => m.role !== "system")
                    .map((m) => (
                      <div
                        key={m.id}
                        className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}
                      >
                        <div
                          className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-sm whitespace-pre-wrap ${
                            m.role === "user"
                              ? "bg-neutral-800"
                              : m.role === "agent"
                              ? "bg-amber-700"
                              : "bg-emerald-700"
                          }`}
                        >
                          {m.role === "agent" && <div className="text-[10px] opacity-70">נציג</div>}
                          {m.content}
                        </div>
                      </div>
                    ))}
                </div>

                {detail.conversation.status === "human" && (
                  <div className="p-3 border-t border-neutral-800 flex gap-2">
                    <input
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && reply.trim() && doAction("reply", reply.trim())}
                      placeholder="כתוב כנציג אנושי…"
                      className="flex-1 bg-neutral-800 rounded-lg px-3 py-2 text-sm outline-none"
                    />
                    <button
                      onClick={() => reply.trim() && doAction("reply", reply.trim())}
                      className="bg-amber-600 hover:bg-amber-500 px-4 py-2 rounded-lg text-sm font-semibold"
                    >
                      שלח
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function Card({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: "emerald" | "amber";
}) {
  const color =
    accent === "emerald"
      ? "text-emerald-400"
      : accent === "amber"
      ? "text-amber-400"
      : "text-neutral-100";
  return (
    <div className="bg-neutral-900 rounded-xl p-3">
      <div className="text-[11px] text-neutral-400">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
    </div>
  );
}
