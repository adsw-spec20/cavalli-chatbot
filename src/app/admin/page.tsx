"use client";

/**
 * פאנל ניהול: אנליטיקה + אינבוקס רב-ערוצי + כפתור כיבוי + ניהול ידע.
 * כל ההודעות מכל הפלטפורמות במקום אחד, עם תיוג מקור ברור.
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
  awaiting: boolean;
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

interface LearnedQA {
  id: string;
  question: string;
  answer: string | null;
  status: string;
  createdAt: number;
}

const CHANNELS: Record<string, { label: string; cls: string }> = {
  whatsapp: { label: "וואטסאפ", cls: "bg-emerald-600" },
  messenger: { label: "מסנג'ר", cls: "bg-blue-600" },
  instagram: { label: "אינסטגרם", cls: "bg-pink-600" },
  playground: { label: "בדיקה", cls: "bg-neutral-600" },
};

const STATUS_LABEL: Record<string, string> = {
  bot: "🤖 בוט",
  human: "🙋 נציג",
  closed: "✓ סגורה",
};

function ChannelBadge({ channel }: { channel: string }) {
  const c = CHANNELS[channel] ?? { label: channel, cls: "bg-neutral-600" };
  return (
    <span className={`text-[10px] text-white rounded px-1.5 py-0.5 ${c.cls}`}>
      {c.label}
    </span>
  );
}

function relTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "עכשיו";
  if (s < 3600) return `לפני ${Math.floor(s / 60)} ד'`;
  if (s < 86400) return `לפני ${Math.floor(s / 3600)} ש'`;
  return `לפני ${Math.floor(s / 86400)} י'`;
}

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
  const [botEnabled, setBotEnabled] = useState(true);
  const [channelFilter, setChannelFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
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
      const [s, c, open, answered, settings] = await Promise.all([
        fetch("/api/admin/stats", { headers: authHeaders() }).then((r) => r.json()),
        fetch("/api/admin/conversations", { headers: authHeaders() }).then((r) => r.json()),
        fetch("/api/admin/knowledge?status=open", { headers: authHeaders() }).then((r) => r.json()),
        fetch("/api/admin/knowledge?status=answered", { headers: authHeaders() }).then((r) => r.json()),
        fetch("/api/admin/settings", { headers: authHeaders() }).then((r) => r.json()),
      ]);
      if (!s.error) setStats(s);
      if (Array.isArray(c)) setConvs(c);
      if (Array.isArray(open)) setOpenQA(open);
      if (Array.isArray(answered)) setAnsweredQA(answered);
      if (typeof settings?.botEnabled === "boolean") setBotEnabled(settings.botEnabled);
    } catch {
      /* ignore transient */
    }
  }, [authHeaders]);

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

  const prevWaiting = useRef(0);
  useEffect(() => {
    const waiting = (stats?.needsAttention ?? 0) + convs.filter((c) => c.awaiting && c.status !== "closed").length;
    document.title = waiting > 0 ? `(${waiting}) ממתינות - ניהול קוואלי` : "ניהול קוואלי";
    if (waiting > prevWaiting.current && "Notification" in window) {
      if (Notification.permission === "granted") {
        new Notification("שיחה ממתינה 🙋", { body: "לקוח מחכה למענה בקפה קוואלי" });
      } else if (Notification.permission !== "denied") {
        Notification.requestPermission();
      }
    }
    prevWaiting.current = waiting;
  }, [stats?.needsAttention, convs]);

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

  async function toggleBot() {
    const next = !botEnabled;
    setBotEnabled(next);
    await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ botEnabled: next }),
    });
    await fetchAll();
  }

  const filtered = convs.filter((c) => {
    if (channelFilter !== "all" && c.channel !== channelFilter) return false;
    if (statusFilter === "awaiting" && !(c.awaiting && c.status !== "closed")) return false;
    if (statusFilter === "escalated" && !c.escalated) return false;
    if (statusFilter === "human" && c.status !== "human") return false;
    return true;
  });

  const maxDay = Math.max(1, ...(stats?.last7Days.map((d) => d.count) ?? [1]));

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 p-4">
      <div className="max-w-6xl mx-auto">
        <header className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <h1 className="text-2xl font-bold">פאנל ניהול - קפה קוואלי</h1>
          <div className="flex items-center gap-3">
            <button
              onClick={toggleBot}
              className={`text-sm font-semibold rounded-lg px-3 py-1.5 transition-colors ${
                botEnabled
                  ? "bg-emerald-700 hover:bg-emerald-600"
                  : "bg-red-700 hover:bg-red-600 animate-pulse"
              }`}
              title="כפתור כיבוי גלובלי"
            >
              {botEnabled ? "🟢 הבוט פעיל" : "🔴 הבוט כבוי"}
            </button>
            <input
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                localStorage.setItem("admin_token", e.target.value);
              }}
              placeholder="ADMIN_TOKEN"
              className="bg-neutral-800 text-xs rounded px-2 py-1 w-36 outline-none"
            />
          </div>
        </header>

        {!botEnabled && (
          <div className="bg-red-900/50 border border-red-700 rounded-lg p-2.5 mb-4 text-sm text-red-200">
            ⚠️ הבוט כבוי. כל ההודעות הנכנסות ממתינות למענה אנושי בלבד. (לחץ "הבוט כבוי" כדי להפעיל מחדש.)
          </div>
        )}

        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
            <Card label="שיחות סה״כ" value={stats.totalConversations} />
            <Card label="% הכלה (בוט סגר)" value={`${stats.deflectionRate}%`} accent="emerald" />
            <Card label="ממתינות לנציג" value={stats.needsAttention} accent={stats.needsAttention > 0 ? "amber" : undefined} />
            <Card label="שאלות ללא מענה" value={stats.openQuestions} accent={stats.openQuestions > 0 ? "amber" : undefined} />
            <Card label="הסלמות" value={stats.escalated} />
            <Card label="הודעות לקוחות" value={stats.totalUserMessages} />
          </div>
        )}

        {stats && (
          <div className="grid md:grid-cols-2 gap-3 mb-4">
            <div className="bg-neutral-900 rounded-xl p-3">
              <div className="text-xs text-neutral-400 mb-2">שיחות ב-7 הימים האחרונים</div>
              <div className="flex items-end gap-1 h-20">
                {stats.last7Days.map((d) => (
                  <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full bg-emerald-600 rounded-t" style={{ height: `${(d.count / maxDay) * 100}%`, minHeight: d.count ? 4 : 0 }} title={`${d.date}: ${d.count}`} />
                    <span className="text-[9px] text-neutral-500">{d.date.slice(5)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-neutral-900 rounded-xl p-3">
              <div className="text-xs text-neutral-400 mb-2">מה הלקוחות הכי שואלים</div>
              <div className="flex flex-wrap gap-1.5">
                {stats.topWords.map((w) => (
                  <span key={w.word} className="text-xs bg-neutral-800 rounded-full px-2 py-0.5">
                    {w.word} <span className="text-neutral-500">{w.count}</span>
                  </span>
                ))}
                {stats.topWords.length === 0 && <span className="text-xs text-neutral-600">עוד אין מספיק נתונים</span>}
              </div>
            </div>
          </div>
        )}

        {/* ידע נלמד */}
        <div className="bg-neutral-900 rounded-xl p-3 mb-4">
          <div className="text-sm font-semibold mb-2">🧠 ידע הבוט - שאלות שצריך לענות עליהן</div>
          {openQA.length === 0 && (
            <div className="text-xs text-neutral-600 mb-1">אין כרגע שאלות פתוחות. כל שאלה שהבוט לא ידע תופיע כאן.</div>
          )}
          <div className="space-y-2">
            {openQA.map((q) => (
              <div key={q.id} className="bg-neutral-800 rounded-lg p-2.5 flex flex-col gap-2">
                <div className="text-sm"><span className="text-amber-400">שאלה:</span> {q.question}</div>
                <div className="flex gap-2">
                  <input
                    value={qaAnswers[q.id] ?? ""}
                    onChange={(e) => setQaAnswers((p) => ({ ...p, [q.id]: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && qaAnswers[q.id]?.trim() && knowledgeAction(q.id, { answer: qaAnswers[q.id].trim() })}
                    placeholder="כתוב את התשובה, והבוט ילמד אותה…"
                    className="flex-1 bg-neutral-900 rounded px-2 py-1.5 text-sm outline-none"
                  />
                  <button onClick={() => qaAnswers[q.id]?.trim() && knowledgeAction(q.id, { answer: qaAnswers[q.id].trim() })} className="text-xs bg-emerald-600 hover:bg-emerald-500 rounded px-3 py-1.5 font-semibold">שמור ולמד</button>
                  <button onClick={() => knowledgeAction(q.id, { action: "delete" })} className="text-xs bg-neutral-700 hover:bg-neutral-600 rounded px-2 py-1.5">התעלם</button>
                </div>
              </div>
            ))}
          </div>
          {answeredQA.length > 0 && (
            <details className="mt-3">
              <summary className="text-xs text-neutral-400 cursor-pointer">ידע שנלמד ({answeredQA.length})</summary>
              <div className="space-y-1.5 mt-2">
                {answeredQA.map((q) => (
                  <div key={q.id} className="text-xs bg-neutral-800/60 rounded p-2 flex items-start justify-between gap-2">
                    <div><span className="text-emerald-400">שאלה:</span> {q.question}<br /><span className="text-neutral-400">תשובה:</span> {q.answer}</div>
                    <button onClick={() => knowledgeAction(q.id, { action: "delete" })} className="text-neutral-500 hover:text-red-400 shrink-0" title="מחק">✕</button>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>

        {/* פילטרים */}
        <div className="flex items-center gap-2 mb-2 flex-wrap text-xs">
          <span className="text-neutral-500">ערוץ:</span>
          {["all", "whatsapp", "messenger", "instagram", "playground"].map((ch) => (
            <button key={ch} onClick={() => setChannelFilter(ch)} className={`rounded px-2 py-1 ${channelFilter === ch ? "bg-neutral-200 text-neutral-900" : "bg-neutral-800"}`}>
              {ch === "all" ? "הכל" : CHANNELS[ch]?.label ?? ch}
            </button>
          ))}
          <span className="text-neutral-500 mr-2">מצב:</span>
          {[["all", "הכל"], ["awaiting", "ממתינות"], ["escalated", "הסלמות"], ["human", "אצל נציג"]].map(([k, l]) => (
            <button key={k} onClick={() => setStatusFilter(k)} className={`rounded px-2 py-1 ${statusFilter === k ? "bg-neutral-200 text-neutral-900" : "bg-neutral-800"}`}>{l}</button>
          ))}
        </div>

        {/* אינבוקס */}
        <div className="grid md:grid-cols-[340px_1fr] gap-3">
          <div className="bg-neutral-900 rounded-xl overflow-hidden max-h-[60vh] overflow-y-auto">
            {filtered.length === 0 && <div className="text-sm text-neutral-600 p-4 text-center">אין שיחות בסינון הזה</div>}
            {filtered.map((c) => (
              <button key={c.id} onClick={() => setSelectedId(c.id)} className={`w-full text-right p-3 border-b border-neutral-800 hover:bg-neutral-800 transition-colors ${selectedId === c.id ? "bg-neutral-800" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <ChannelBadge channel={c.channel} />
                    {c.awaiting && c.status !== "closed" && <span className="w-2 h-2 rounded-full bg-amber-400" title="ממתין למענה" />}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {c.escalated && <span className="text-[10px] bg-amber-600/80 rounded px-1.5 py-0.5">הסלמה</span>}
                    <span className="text-[10px] text-neutral-500">{relTime(c.updatedAt)}</span>
                  </div>
                </div>
                <div className="text-sm text-neutral-300 truncate mt-1">{c.lastMessage || "(אין הודעות)"}</div>
                <div className="text-[10px] text-neutral-500 mt-1">{STATUS_LABEL[c.status]} · {c.messageCount} הודעות</div>
              </button>
            ))}
          </div>

          <div className="bg-neutral-900 rounded-xl flex flex-col max-h-[60vh]">
            {!detail && <div className="text-sm text-neutral-600 p-6 text-center">בחר שיחה כדי לצפות ולהשתלט</div>}
            {detail && (
              <>
                <div className="p-3 border-b border-neutral-800 flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 text-xs text-neutral-400">
                      <ChannelBadge channel={detail.conversation.channel} />
                      <span>{STATUS_LABEL[detail.conversation.status]}</span>
                      {detail.conversation.escalationReason && <span className="text-amber-400">· {detail.conversation.escalationReason}</span>}
                    </div>
                    <div className="flex gap-1.5">
                      {detail.conversation.status !== "human" && <button onClick={() => doAction("takeover")} className="text-xs bg-amber-600 hover:bg-amber-500 rounded px-2 py-1">השתלט</button>}
                      {detail.conversation.status === "human" && <button onClick={() => doAction("release")} className="text-xs bg-emerald-600 hover:bg-emerald-500 rounded px-2 py-1">החזר לבוט</button>}
                      <button onClick={() => doAction("close")} className="text-xs bg-neutral-700 hover:bg-neutral-600 rounded px-2 py-1">סגור</button>
                    </div>
                  </div>
                  {detail.conversation.escalationSummary && (
                    <div className="text-xs bg-amber-950/60 border border-amber-800/50 rounded-lg p-2 text-amber-200">
                      <span className="font-semibold">📋 סיכום לנציג:</span> {detail.conversation.escalationSummary}
                    </div>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {detail.messages.filter((m) => m.role !== "system").map((m) => (
                    <div key={m.id} className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}>
                      <div className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-sm whitespace-pre-wrap ${m.role === "user" ? "bg-neutral-800" : m.role === "agent" ? "bg-amber-700" : "bg-emerald-700"}`}>
                        {m.role === "agent" && <div className="text-[10px] opacity-70">נציג</div>}
                        {m.content}
                      </div>
                    </div>
                  ))}
                </div>

                {detail.conversation.status === "human" && (
                  <div className="p-3 border-t border-neutral-800 flex gap-2">
                    <input value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => e.key === "Enter" && reply.trim() && doAction("reply", reply.trim())} placeholder="כתוב כנציג אנושי…" className="flex-1 bg-neutral-800 rounded-lg px-3 py-2 text-sm outline-none" />
                    <button onClick={() => reply.trim() && doAction("reply", reply.trim())} className="bg-amber-600 hover:bg-amber-500 px-4 py-2 rounded-lg text-sm font-semibold">שלח</button>
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

function Card({ label, value, accent }: { label: string; value: string | number; accent?: "emerald" | "amber" }) {
  const color = accent === "emerald" ? "text-emerald-400" : accent === "amber" ? "text-amber-400" : "text-neutral-100";
  return (
    <div className="bg-neutral-900 rounded-xl p-3">
      <div className="text-[11px] text-neutral-400">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
    </div>
  );
}
