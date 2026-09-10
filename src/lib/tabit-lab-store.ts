/**
 * היסטוריית שיחות של בוט הטאביט - סשנים נשמרים בצד השרת.
 *
 * למה: (1) המעבדה לא מתאפסת כשיוצאים וחוזרים - ממשיכים מאותה שיחה;
 * (2) המנהל הראשי רואה את **כל** השיחות (כולל של בוט הקבוצה בוואטסאפ, כשיחובר)
 * כדי לעקוב, לזהות התנהגויות לא רצויות ולשפר.
 *
 * אחסון: KV (settings) - אינדקס אחד קטן + מפתח נפרד לכל סשן. מבודד לגמרי
 * משיחות הלקוחות של הבוט הציבורי. תקרות: 60 סשנים, 300 הודעות לסשן,
 * ולוג-כלים מקוצץ כדי לא לנפח את ה-KV.
 */

import { randomUUID } from "crypto";
import { getRepo } from "./db";

const INDEX_KEY = "tabit_lab_index";
const sKey = (id: string) => `tabit_lab_s:${id}`;
const MAX_SESSIONS = 60;
const MAX_MSGS = 300;
const MAX_TOOL_ENTRIES = 8;
const MAX_TOOL_CHARS = 4000;

export type LabSource = "panel" | "group";

export interface LabToolEntry {
  tool: string;
  params: unknown;
  ok: boolean;
  result?: unknown;
  error?: string;
}
export interface LabMsg {
  role: "user" | "assistant";
  content: string;
  ts: number;
  toolLog?: LabToolEntry[];
}
export interface LabSessionMeta {
  id: string;
  title: string;
  source: LabSource;
  createdAt: number;
  updatedAt: number;
  count: number;
}
export interface LabSession extends LabSessionMeta {
  messages: LabMsg[];
}

async function readIndex(): Promise<LabSessionMeta[]> {
  try {
    const raw = await getRepo().getSetting(INDEX_KEY);
    const arr = raw ? (JSON.parse(raw) as LabSessionMeta[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
async function writeIndex(list: LabSessionMeta[]): Promise<void> {
  await getRepo().setSetting(INDEX_KEY, JSON.stringify(list));
}

export async function listLabSessions(): Promise<LabSessionMeta[]> {
  return readIndex();
}

export async function getLabSession(id: string): Promise<LabSession | null> {
  if (!id) return null;
  try {
    const raw = await getRepo().getSetting(sKey(id));
    if (!raw) return null;
    const s = JSON.parse(raw) as LabSession;
    return s && Array.isArray(s.messages) ? s : null;
  } catch {
    return null;
  }
}

export async function deleteLabSession(id: string): Promise<void> {
  const idx = await readIndex();
  await writeIndex(idx.filter((s) => s.id !== id));
  await getRepo().setSetting(sKey(id), "");
}

/** קיצוץ לוג הכלים לפני שמירה - תוצאות כלי יכולות להיות ענקיות (עד 40KB) */
function trimToolLog(toolLog?: LabToolEntry[]): LabToolEntry[] | undefined {
  if (!toolLog?.length) return undefined;
  return toolLog.slice(0, MAX_TOOL_ENTRIES).map((t) => {
    const out: LabToolEntry = { tool: t.tool, params: t.params, ok: t.ok };
    if (t.error) out.error = String(t.error).slice(0, 500);
    if (t.result !== undefined) {
      const json = JSON.stringify(t.result);
      out.result = json.length > MAX_TOOL_CHARS ? json.slice(0, MAX_TOOL_CHARS) + "…(קוצץ)" : t.result;
    }
    return out;
  });
}

/**
 * מוסיף חילופי הודעות (שאלה + תשובה) לסשן. יוצר את הסשן אם לא קיים -
 * גם עם מזהה מפורש (בוט הקבוצה משתמש במזהה קבוע לפי הצ'אט).
 * מחזיר את מזהה הסשן.
 */
export async function appendLabExchange(args: {
  sessionId?: string | null;
  source: LabSource;
  title?: string;
  userContent: string;
  assistantContent: string;
  toolLog?: LabToolEntry[];
}): Promise<{ sessionId: string }> {
  const now = Date.now();
  let session = args.sessionId ? await getLabSession(args.sessionId) : null;
  if (!session) {
    session = {
      id: args.sessionId || randomUUID(),
      title: (args.title || args.userContent || "שיחה").trim().slice(0, 60),
      source: args.source,
      createdAt: now,
      updatedAt: now,
      count: 0,
      messages: [],
    };
  }
  session.messages.push({ role: "user", content: args.userContent, ts: now });
  session.messages.push({ role: "assistant", content: args.assistantContent, ts: now, toolLog: trimToolLog(args.toolLog) });
  if (session.messages.length > MAX_MSGS) session.messages = session.messages.slice(-MAX_MSGS);
  session.updatedAt = now;
  session.count = session.messages.length;
  await getRepo().setSetting(sKey(session.id), JSON.stringify(session));

  // עדכון האינדקס: הסשן קופץ לראש; חריגה מהתקרה מוחקת את הישן ביותר (כולל התוכן)
  const idx = (await readIndex()).filter((s) => s.id !== session.id);
  idx.unshift({ id: session.id, title: session.title, source: session.source, createdAt: session.createdAt, updatedAt: session.updatedAt, count: session.count });
  const evicted = idx.slice(MAX_SESSIONS);
  const kept = idx.slice(0, MAX_SESSIONS);
  await writeIndex(kept);
  for (const ev of evicted) {
    await getRepo().setSetting(sKey(ev.id), "").catch(() => {});
  }
  return { sessionId: session.id };
}
