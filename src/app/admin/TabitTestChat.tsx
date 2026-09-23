"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, relTime } from "./types";
import { useChatBoxHeight } from "./use-chat-height";
import { mdToWhatsApp } from "@/lib/tabit-format";

/** עיצוב טקסט inline: **מודגש** / *מודגש* -> bold */
function renderInline(text: string, kp: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\n]+\*)/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<strong key={`${kp}b${i++}`}>{m[0].replace(/^\*+|\*+$/g, "")}</strong>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** מציג מרקדאון קליל: טבלאות, רשימות, כותרות, והדגשות - יפה ונקי. */
function MarkdownLite({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0, key = 0;
  const isRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
  const isSep = (cells: string[]) => cells.every((c) => /^[-:\s]*$/.test(c));
  while (i < lines.length) {
    const line = lines[i];
    if (isRow(line)) {
      const rows: string[][] = [];
      while (i < lines.length && isRow(lines[i])) {
        rows.push(lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
        i++;
      }
      const data = rows.filter((r) => !isSep(r));
      const head = data[0] || [];
      const body = data.slice(1);
      blocks.push(
        <div key={key++} className="overflow-x-auto my-1.5">
          <table className="text-xs border-collapse" style={{ minWidth: "100%" }}>
            <thead><tr>{head.map((h, hi) => <th key={hi} className="border border-[var(--border)] bg-[var(--panel)] px-2 py-1 text-right font-semibold whitespace-nowrap">{renderInline(h, `h${hi}`)}</th>)}</tr></thead>
            <tbody>{body.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci} className="border border-[var(--border)] px-2 py-1 text-right whitespace-nowrap">{renderInline(c, `c${ri}_${ci}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
      continue;
    }
    if (/^\s*[-•*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-•*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-•*]\s+/, "")); i++; }
      blocks.push(<ul key={key++} className="list-disc pr-5 my-1 space-y-0.5">{items.map((it, ii) => <li key={ii}>{renderInline(it, `li${ii}`)}</li>)}</ul>);
      continue;
    }
    if (/^\s*#{1,4}\s+/.test(line)) {
      blocks.push(<div key={key++} className="font-bold text-[15px] mt-2 mb-0.5">{renderInline(line.replace(/^\s*#{1,4}\s+/, ""), "hd")}</div>);
      i++; continue;
    }
    if (line.trim() === "") { blocks.push(<div key={key++} className="h-2" />); i++; continue; }
    blocks.push(<div key={key++} className="leading-relaxed">{renderInline(line, `p${i}`)}</div>);
    i++;
  }
  return <div>{blocks}</div>;
}

// ההמרה למרקדאון->וואטסאפ עברה ל-src/lib/tabit-format.ts (17.9), יחד עם
// שאר הפורמט. היא הייתה כאן בלבד, ולכן אי אפשר היה לבדוק אותה - והיא
// בדיוק מה שהצוות מקבל בפועל כשמעתיקים תשובה לקבוצה.

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => {}); }}
      className="text-[10px] text-[var(--muted)] hover:text-[var(--text)] border border-[var(--border)] rounded-md px-2 py-0.5"
      title="מעתיק בפורמט וואטסאפ נקי"
    >
      {done ? "הועתק ✓" : "העתק לוואטסאפ"}
    </button>
  );
}

/** בועת תשובת הבוט: טבלה יפה בממשק, והעתקה בפורמט וואטסאפ נקי. */
function AssistantContent({ text, tools }: { text: string; tools?: ToolEntry[] }) {
  const waText = useMemo(() => mdToWhatsApp(text), [text]);
  return (
    <>
      <div dir="auto" className="rounded-2xl px-3 py-2 text-sm break-words bg-[var(--panel2)] text-[var(--text)]">
        <MarkdownLite text={text} />
      </div>
      <div className="flex items-center gap-2 mt-1">
        <CopyBtn text={waText} />
      </div>
      {tools && <ToolLog tools={tools} />}
    </>
  );
}

/**
 * מעבדת טאביט - צ'אט AI מבודד לבדיקת החיבורים לטאביט (לכל הצוות מ-15.9;
 * כפתור ההיסטוריה - מנהל בלבד).
 * מ-10.9 השיחות נשמרות בצד השרת: יציאה וחזרה ממשיכות את אותה שיחה,
 * וכפתור "היסטוריה" מציג את כל השיחות (כולל של בוט הקבוצה בוואטסאפ) -
 * למעקב ובקרה על התנהגות הבוט.
 */

interface ToolEntry {
  tool: string;
  params: unknown;
  ok: boolean;
  result?: unknown;
  error?: string;
  /** תיאור בעברית של מה נבדק, נבנה בשרת */
  summary?: string;
  /** כמה זמן לקחה הבדיקה */
  ms?: number;
}
interface Msg {
  role: "user" | "assistant";
  text: string;
  tools?: ToolEntry[];
}
interface SessionMeta {
  id: string;
  title: string;
  source: "panel" | "group";
  createdAt: number;
  updatedAt: number;
  count: number;
}
interface SessionFull extends SessionMeta {
  messages: { role: "user" | "assistant"; content: string; ts: number; toolLog?: ToolEntry[] }[];
}

const LS_KEY = "tabit_lab_last_session";

const SUGGESTIONS = [
  "מה ההזמנות של מחר?",
  "מי לא שילם פיקדון להיום?",
  "כמה אי-הגעות וביטולים היו אתמול?",
  "כמה עשינו אתמול?",
  "כמה שולחנות גדולים יש היום?",
  "תמצא לי את ההזמנה של ",
  "יש מקום ל-6 היום ב-20:00 בחוץ?",
  "מה מצב השולחנות עכשיו?",
];

/**
 * "איך זה נבדק" - הדרך של הצוות לאמת מספר בלי לשאול אותי.
 *
 * עד 24.9 זה היה JSON גולמי, כלומר בפועל לא נקרא על ידי אף אחד. עכשיו כל שורה
 * אומרת בעברית מה נבדק, על איזה טווח וכמה זמן זה לקח, וה-JSON נשאר מתחת למי
 * שבאמת רוצה אותו.
 */
function ToolLog({ tools }: { tools: ToolEntry[] }) {
  const [open, setOpen] = useState(false);
  const [rawOf, setRawOf] = useState<number | null>(null);
  if (!tools.length) return null;
  const failed = tools.filter((t) => !t.ok).length;
  return (
    <div className="mt-1.5">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`text-[11px] rounded-lg px-2 py-0.5 border ${
          failed
            ? "text-red-400 border-red-500/40"
            : "text-[var(--muted)] hover:text-[var(--text)] border-[var(--border)]"
        }`}
      >
        🔍 איך זה נבדק ({tools.length}{failed ? `, ${failed} נכשלו` : ""}) {open ? "▲" : "▼"}
      </button>
      {open && (
        <div className="mt-1.5 space-y-1">
          {tools.map((t, i) => (
            <div key={i} className={`rounded-lg border px-2.5 py-1.5 text-[11px] ${t.ok ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"}`}>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span>{t.ok ? "✓" : "✗"}</span>
                <b>{t.summary || t.tool}</b>
                {t.ms != null && <span className="text-[var(--muted)]">{(t.ms / 1000).toFixed(1)} שנ׳</span>}
                <button
                  onClick={() => setRawOf(rawOf === i ? null : i)}
                  className="mr-auto text-[10px] text-[var(--muted)] hover:text-[var(--text)] underline underline-offset-2"
                >
                  {rawOf === i ? "הסתר נתונים" : "נתונים גולמיים"}
                </button>
              </div>
              {!t.ok && <div className="mt-0.5 text-red-300">{t.error}</div>}
              {rawOf === i && (
                <pre dir="ltr" className="mt-1 whitespace-pre-wrap break-words text-[10px] text-[var(--muted)] max-h-56 overflow-auto">
                  {t.tool} {JSON.stringify(t.params)}
                  {"\n\n"}
                  {t.ok ? JSON.stringify(t.result, null, 2) : t.error}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const msgsFromSession = (s: SessionFull): Msg[] =>
  s.messages.map((m) => ({ role: m.role, text: m.content, tools: m.toolLog }));

export default function TabitTestChat({ token, isMaster }: { token: string; isMaster?: boolean }) {
  const { ref: boxRef, height: boxH, overlay: boxOverlay } = useChatBoxHeight();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [msgs]);

  // חימום הסוכן ברגע שהלשונית נפתחת. הוא סורק כל 15 שניות כשהוא שקט, ולכן בלי
  // זה השאלה הראשונה בכל שיחה חיכתה עוד לפני שטאביט נגע בה.
  useEffect(() => {
    api(token, "/tabit/wake", { method: "POST" }).catch(() => { /* חימום נחמד, לא קריטי */ });
  }, [token]);

  // מד זמן חי במקום נקודות מהבהבות: כשיודעים כמה זמן עבר, ההמתנה פחות מלחיצה
  // ואפשר לדווח "זה לקח 12 שניות" במקום "זה איטי".
  useEffect(() => {
    if (!busy) { setElapsed(0); return; }
    const started = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 250);
    return () => clearInterval(id);
  }, [busy]);

  // שחזור השיחה האחרונה - המעבדה לא מתאפסת כשיוצאים וחוזרים
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(LS_KEY); } catch { /* ignore */ }
    if (!saved) return;
    api<{ session: SessionFull }>(token, `/tabit/lab-sessions/${saved}`)
      .then((d) => {
        setMsgs(msgsFromSession(d.session));
        setSessionId(d.session.id);
      })
      .catch(() => { try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ } });
  }, [token]);

  async function loadSessions() {
    try {
      const d = await api<{ sessions: SessionMeta[] }>(token, "/tabit/lab-sessions");
      setSessions(d.sessions || []);
    } catch { /* לא קריטי */ }
  }
  function openHistory() {
    setConfirmDelete(null);
    setHistoryOpen(true);
    loadSessions();
  }
  async function openSession(id: string) {
    try {
      const d = await api<{ session: SessionFull }>(token, `/tabit/lab-sessions/${id}`);
      setMsgs(msgsFromSession(d.session));
      setSessionId(d.session.id);
      try { localStorage.setItem(LS_KEY, d.session.id); } catch { /* ignore */ }
      setHistoryOpen(false);
    } catch { /* ignore */ }
  }
  async function removeSession(id: string) {
    try {
      await api(token, `/tabit/lab-sessions/${id}`, { method: "DELETE" });
      setSessions((s) => s.filter((x) => x.id !== id));
      setConfirmDelete(null);
      if (id === sessionId) newChat();
    } catch { /* ignore */ }
  }
  function newChat() {
    setMsgs([]);
    setSessionId(null);
    try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
  }

  // לחיצה על צ'יפ ממלאת את תיבת הצ'אט (לא שולחת) כדי שאפשר לערוך/להשלים לפני שליחה
  function fillFromChip(text: string) {
    setInput(text);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        const end = el.value.length;
        el.setSelectionRange(end, end);
      }
    });
  }

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", text: content }]);
    setBusy(true);
    try {
      const data = await api<{ reply: string; toolLog: ToolEntry[]; sessionId: string }>(token, "/tabit/testchat", {
        method: "POST",
        body: JSON.stringify({ sessionId, message: content }),
      });
      setMsgs((m) => [...m, { role: "assistant", text: data.reply, tools: data.toolLog || [] }]);
      if (data.sessionId) {
        setSessionId(data.sessionId);
        try { localStorage.setItem(LS_KEY, data.sessionId); } catch { /* ignore */ }
      }
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", text: `⚠ ${e instanceof Error ? e.message : "שגיאה"}`, tools: [] }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <p className="text-xs text-[var(--muted)]">
          צ'אט מבודד לבדיקת טאביט - השיחות נשמרות אוטומטית, אפשר לצאת ולחזור להמשיך.
        </p>
        <div className="flex gap-1.5 shrink-0">
          {/* היסטוריית כל השיחות (כולל בוט הקבוצה) - כלי בקרה של המנהל בלבד */}
          {isMaster && (
            <button
              onClick={openHistory}
              className="text-xs text-[var(--muted)] hover:text-[var(--text)] border border-[var(--border)] rounded-lg px-2.5 py-1.5"
            >
              🕘 היסטוריה
            </button>
          )}
          <button
            onClick={newChat}
            className="text-xs text-[var(--muted)] hover:text-[var(--text)] border border-[var(--border)] rounded-lg px-2.5 py-1.5"
          >
            שיחה חדשה
          </button>
        </div>
      </div>

      {/* הגובה נמדד חי (use-chat-height). כשמקלדת המובייל פתוחה - מצב הקלדה:
          הצ'אט תופס את כל המסך הנראה מעל המקלדת (כמו וואטסאפ), ושדה ההקלדה תמיד גלוי. */}
      <div
        ref={boxRef}
        style={boxH != null ? { height: boxH } : undefined}
        className={`bg-[var(--panel)] border border-[var(--border)] flex flex-col min-h-[180px] ${
          boxOverlay
            ? "fixed inset-x-0 top-0 z-[70] rounded-none border-x-0 border-t-0"
            : "rounded-2xl h-[calc(var(--app-h,100dvh)-250px)] md:h-[calc(var(--app-h,100dvh)-200px)]"
        }`}
      >
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
          {msgs.length === 0 && (
            <div className="text-center text-sm text-[var(--muted)] mt-8 space-y-3">
              <div>שלח הודעה כדי לבדוק את החיבור לטאביט 👇</div>
              <div className="flex flex-wrap gap-2 justify-center">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => fillFromChip(s)} className="text-xs border border-[var(--border)] rounded-full px-3 py-1.5 hover:border-[var(--accent)] hover:text-[var(--accent)]">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {msgs.map((m, i) => {
            const isAssistant = m.role === "assistant" && !m.text.startsWith("⚠");
            return (
              <div key={i} className={`flex ${m.role === "assistant" ? "justify-start" : "justify-end"}`}>
                <div className="max-w-[92%] md:max-w-[85%]">
                  {isAssistant ? (
                    <AssistantContent text={m.text} tools={m.tools} />
                  ) : (
                    <div dir="auto" className={`rounded-2xl px-3 py-2 text-sm break-words whitespace-pre-wrap ${m.role === "user" ? "bg-[var(--accent)] text-[var(--accent-fg)]" : "bg-red-500/15 text-red-300 border border-red-500/25"}`}>
                      {m.text}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {busy && (
            <div className="text-xs text-[var(--muted)] flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse" />
              מריץ מול טאביט…
              {elapsed > 1 && <span className="tabular-nums">{elapsed} שנ׳</span>}
              {elapsed > 20 && <span>(שאלות על ימי עבר נשלפות מהארכיון ולוקחות יותר)</span>}
            </div>
          )}
        </div>
        <div className="border-t border-[var(--border)] p-2.5 flex gap-2">
          <input
            ref={inputRef}
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

      {/* היסטוריית שיחות - מעקב ובקרה (כולל שיחות בוט הקבוצה) */}
      {historyOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={() => setHistoryOpen(false)}>
          <div
            className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="px-4 py-3 border-b border-[var(--border)] flex items-center gap-2">
              <h2 className="font-semibold font-display text-base">🕘 היסטוריית שיחות</h2>
              <span className="text-xs text-[var(--muted)]">{sessions.length}</span>
              <button onClick={() => setHistoryOpen(false)} className="mr-auto text-[var(--muted)] hover:text-[var(--text)] rounded-lg px-2 py-1 border border-[var(--border)] text-sm">
                ✕
              </button>
            </header>
            <div className="flex-1 overflow-y-auto p-3">
              {sessions.length === 0 ? (
                <div className="text-sm text-[var(--muted)] text-center py-8">אין עדיין שיחות שמורות</div>
              ) : (
                <div className="rounded-xl border border-[var(--border)] overflow-hidden divide-y divide-[var(--border)]">
                  {sessions.map((s) => (
                    <div key={s.id} className={`px-3 py-2.5 flex items-center gap-2 ${s.id === sessionId ? "bg-[var(--panel2)]" : ""}`}>
                      <button onClick={() => openSession(s.id)} className="flex-1 min-w-0 text-start">
                        <div className="text-sm font-medium truncate">{s.title || "(ללא כותרת)"}</div>
                        <div className="text-[11px] text-[var(--muted)]">
                          {s.source === "group" ? "💬 קבוצה" : "🖥️ מעבדה"} · {relTime(s.updatedAt)} · {Math.ceil(s.count / 2)} חילופים
                        </div>
                      </button>
                      {confirmDelete === s.id ? (
                        <button onClick={() => removeSession(s.id)} className="shrink-0 text-[11px] text-red-400 border border-red-500/40 rounded-lg px-2 py-1">
                          בטוח? מחק
                        </button>
                      ) : (
                        <button onClick={() => setConfirmDelete(s.id)} title="מחק שיחה" className="shrink-0 text-[var(--muted)] hover:text-red-400 rounded-lg px-2 py-1 text-xs">
                          🗑
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
