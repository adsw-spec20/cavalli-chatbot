"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "./types";

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

/** מספר ישראלי נייד -> 05X-XXX-XXXX. אחרת מחזיר כמו שהוא. */
function fmtPhone(p: string): string {
  const d = p.replace(/\D/g, "").replace(/^972/, "0");
  return /^0\d{9}$/.test(d) ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : p.trim();
}

/**
 * ממיר markdown (כולל טבלאות) לטקסט ידידותי לוואטסאפ:
 * טבלה -> שורה להזמנה, כוכבית בודדת להדגשה, בלי מקפים ארוכים/חצים שנשברים.
 * זה מה שנשלח בפועל כשמעתיקים - ככה הצוות רואה את זה בקבוצה.
 */
function mdToWhatsApp(md: string): string {
  const src = md.split("\n");
  const out: string[] = [];
  let i = 0;
  const isRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
  const isSep = (cells: string[]) => cells.every((c) => /^[-:\s]*$/.test(c));
  const clean = (s: string) =>
    s
      .replace(/\*\*/g, "*")            // ** -> * (הדגשת וואטסאפ)
      .replace(/\s*[—–]\s*/g, " - ")    // מקף ארוך -> מקף רגיל
      .replace(/\s*[←→⇐⇒]\s*/g, " ")    // חצים החוצה
      .replace(/ {2,}/g, " ");
  while (i < src.length) {
    const line = src[i];
    if (isRow(line)) {
      const rows: string[][] = [];
      while (i < src.length && isRow(src[i])) {
        rows.push(src[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
        i++;
      }
      const data = rows.filter((r) => !isSep(r));
      if (!data.length) continue;
      const header = data[0].map((h) => h.replace(/\*/g, "").trim());
      for (const r of data.slice(1)) {
        const parts: string[] = [];
        r.forEach((cellRaw, ci) => {
          const cell = clean(cellRaw).trim();
          if (!cell || cell === "-" || cell === "—") return;
          if (ci === 0) { parts.push(`*${cell.replace(/\*/g, "")}*`); return; }
          const h = header[ci] || "";
          if (h === "סועדים") parts.push(`${cell.replace(/\*/g, "")} סועדים`);
          else if (h === "שולחנות" || h === "שולחן") parts.push(`ש׳ ${cell}`);
          else if (h === "טלפון" || h === "נייד") parts.push(fmtPhone(cell));
          else parts.push(cell);
        });
        if (parts.length) out.push(parts.join(" •• "));
      }
      continue;
    }
    if (/^\s*[-_*]{3,}\s*$/.test(line)) { out.push(""); i++; continue; }  // קו מפריד -> רווח
    out.push(clean(line).replace(/^\s*[-*•]\s+/, "• "));                  // תבליט -> •
    i++;
  }
  return out.join("\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

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
  "מה ההזמנות הגדולות מחר?",
  "למי חסר פיקדון מחר?",
  "יש מקום ל-8 אנשים בשבת ב-20:00?",
  "מצב השולחנות עכשיו",
  "כמה אי-הגעות וביטולים היו החודש?",
  "פילוח מקורות ההזמנות",
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
