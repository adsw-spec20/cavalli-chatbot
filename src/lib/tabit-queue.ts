/**
 * תור פקודות דו-כיווני בין השרת לגשר המקומי של טאביט.
 *
 * הצ'אט-בדיקה (בשרת) מכניס פקודה (enqueue) וממתין לתוצאה. הסוכן המקומי
 * (agent.js) מושך פקודה ממתינה (claimNext), מבצע אותה מול טאביט דרך הדפדפן
 * המחובר, ומחזיר תוצאה (submitResult). הכל נשמר ב-KV הקיים (בלי מיגרציה),
 * כל פקודה במפתח נפרד כדי למזער התנגשויות קריאה-שינוי-כתיבה.
 *
 * זהו מסלול מבודד לגמרי מצינור הצ'אטבוט הציבורי.
 */

import { randomUUID } from "crypto";
import { getRepo } from "./db";

export type TabitAction =
  | "health"
  | "read_day"
  | "big_tables"
  | "covers_summary"
  | "deposit_summary"
  | "get_deposit_link"
  | "create_reservation"
  | "check_availability"
  | "customer_lookup"
  | "tables_status"
  | "no_show_summary"
  | "day_outcome"
  | "booking_sources"
  | "modify_reservation"
  | "cancel_reservation"
  | "shift_dashboard"
  | "revenue_summary"
  | "notification_status"
  | "floor_map"
  | "refresh_snapshot";

export type TabitCommandStatus = "pending" | "running" | "done" | "error";

export interface TabitCommand {
  id: string;
  action: TabitAction;
  params: Record<string, unknown>;
  status: TabitCommandStatus;
  result: unknown;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

const PENDING_KEY = "tabit_q_pending";
const cmdKey = (id: string) => `tabit_q_cmd:${id}`;

/**
 * חימום הסוכן.
 *
 * הסוכן סורק כל 2 שניות כשהוא "חם" וכל 15 כשהוא שקט, והמצב החם נדלק רק **אחרי**
 * הפקודה הראשונה. התוצאה: השאלה הראשונה בכל שיחה שילמה עד 15 שניות המתנה עוד
 * לפני שטאביט בכלל נגע בה, וזה חלק גדול מהתחושה שהמעבדה איטית.
 *
 * הפתרון: כשנפתחת לשונית המעבדה (או נשלחת הודעה) מסומן כאן חותם זמן, והסוכן
 * קורא אותו באותה בקשה שבה הוא ממילא מושך פקודות. אפס בקשות נוספות, אפס פולינג
 * נוסף - עד שהמשתמש מקליד את השאלה הסוכן כבר ער.
 */
const LAB_ACTIVE_KEY = "tabit_lab_active_at";
/** כמה זמן אחרי סימון פעילות הסוכן נשאר בסריקה מהירה */
export const LAB_HOT_MS = 3 * 60_000;

export async function markLabActive(): Promise<void> {
  try { await getRepo().setSetting(LAB_ACTIVE_KEY, String(Date.now())); } catch { /* חימום זה נחמד, לא קריטי */ }
}

export async function isLabHot(): Promise<boolean> {
  try {
    const raw = await getRepo().getSetting(LAB_ACTIVE_KEY);
    const ts = raw ? Number(raw) : 0;
    return Number.isFinite(ts) && ts > 0 && Date.now() - ts < LAB_HOT_MS;
  } catch { return false; }
}

async function readPending(): Promise<string[]> {
  const raw = await getRepo().getSetting(PENDING_KEY);
  try { return raw ? (JSON.parse(raw) as string[]) : []; } catch { return []; }
}
async function writePending(ids: string[]): Promise<void> {
  await getRepo().setSetting(PENDING_KEY, JSON.stringify(ids));
}

export async function enqueue(action: TabitAction, params: Record<string, unknown>): Promise<string> {
  const id = randomUUID();
  const now = Date.now();
  const cmd: TabitCommand = { id, action, params, status: "pending", result: null, error: null, createdAt: now, updatedAt: now };
  await getRepo().setSetting(cmdKey(id), JSON.stringify(cmd));
  const pending = await readPending();
  pending.push(id);
  await writePending(pending);
  return id;
}

export async function getCommand(id: string): Promise<TabitCommand | null> {
  const raw = await getRepo().getSetting(cmdKey(id));
  if (!raw) return null;
  try { return JSON.parse(raw) as TabitCommand; } catch { return null; }
}

/** הסוכן המקומי: תפוס את הפקודה הממתינה הבאה וסמן אותה running. */
export async function claimNext(): Promise<TabitCommand | null> {
  const pending = await readPending();
  if (!pending.length) return null;
  const id = pending.shift()!;
  await writePending(pending);
  const cmd = await getCommand(id);
  if (!cmd) return null;
  cmd.status = "running";
  cmd.updatedAt = Date.now();
  await getRepo().setSetting(cmdKey(id), JSON.stringify(cmd));
  return cmd;
}

/** הסוכן המקומי: החזר תוצאה לפקודה. */
export async function submitResult(id: string, status: "done" | "error", result: unknown, error?: string | null): Promise<void> {
  const cmd = await getCommand(id);
  if (!cmd) return;
  cmd.status = status;
  cmd.result = result ?? null;
  cmd.error = error ?? null;
  cmd.updatedAt = Date.now();
  await getRepo().setSetting(cmdKey(id), JSON.stringify(cmd));
}

/** הצ'אט: הכנס פקודה והמתן לתוצאה (עד timeoutMs). זורק אם פג הזמן / שגיאה. */
export async function runCommand(
  action: TabitAction,
  params: Record<string, unknown>,
  timeoutMs = 25_000
): Promise<unknown> {
  const id = await enqueue(action, params);
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 700));
    const cmd = await getCommand(id);
    if (!cmd) continue;
    if (cmd.status === "done") return cmd.result;
    if (cmd.status === "error") throw new Error(cmd.error || "הפעולה נכשלה בסוכן המקומי");
  }
  throw new Error("הסוכן המקומי לא הגיב בזמן - ודא שהוא רץ (node agent.js) ושהמחשב מחובר לטאביט");
}
