/**
 * עריכת "מוח הבוט" - שכבת דריסה (overrides) מעל ההוראות והתבניות שבקוד.
 *
 * הרעיון: הקוד נשאר מקור ברירת המחדל, ומה שנערך בפאנל נשמר ב-DB ודורס אותו
 * בזמן ריצה. כך אפשר לערוך כל כלל וכל תבנית בלי לפרוס קוד, ובלי לאבד את
 * ברירת המחדל - אפשר תמיד לחזור אליה בלחיצה.
 *
 * ⚠️ הדריסה אמיתית: הטקסט הערוך נכנס ל-System Prompt שנשלח למודל בכל הודעה,
 * ולתשובות החינמיות שנשלחות ללקוח. זו לא תצוגה.
 *
 * עוגן בטיחות: לכל דריסה נשמר גם הטקסט המקורי שממנו היא נוצרה. אם הקוד
 * ישתנה בעתיד (כלל ינוסח מחדש, יוסר או ימוספר אחרת), הדריסה תסומן כ"מיושנת"
 * ולא תוחל בשקט על טקסט שכבר לא קיים.
 */

import { getRepo } from "./db";

const KEY = "brain_overrides";
const HISTORY_KEY = "brain_history";
const MAX_HISTORY = 30;

export interface BrainOverride {
  /** מזהה הפריט (rule-6 / canned-location / sec-3) */
  id: string;
  /** הטקסט החדש שהמנהל כתב */
  text: string;
  /** הטקסט שהיה שם כשהעריכה נעשתה - עוגן לזיהוי מיושנוּת */
  base: string;
  updatedAt: number;
  note?: string;
}

export interface BrainOverrides {
  items: Record<string, BrainOverride>;
  version: number;
  updatedAt: number;
}

const EMPTY: BrainOverrides = { items: {}, version: 0, updatedAt: 0 };

export async function loadOverrides(): Promise<BrainOverrides> {
  try {
    const raw = await getRepo().getSetting(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as BrainOverrides;
    return parsed && typeof parsed === "object" && parsed.items ? parsed : EMPTY;
  } catch {
    return EMPTY;
  }
}

async function saveOverrides(o: BrainOverrides): Promise<void> {
  await getRepo().setSetting(KEY, JSON.stringify(o));
}

/** שמירת גרסה להיסטוריה, כדי שאפשר יהיה לחזור אחורה. */
async function pushHistory(o: BrainOverrides, action: string): Promise<void> {
  try {
    const raw = await getRepo().getSetting(HISTORY_KEY);
    const hist = raw ? (JSON.parse(raw) as { at: number; action: string; snapshot: BrainOverrides }[]) : [];
    hist.unshift({ at: Date.now(), action, snapshot: o });
    await getRepo().setSetting(HISTORY_KEY, JSON.stringify(hist.slice(0, MAX_HISTORY)));
  } catch {
    /* היסטוריה היא נוחות, לא תנאי לשמירה */
  }
}

export async function listHistory(): Promise<{ at: number; action: string; count: number }[]> {
  try {
    const raw = await getRepo().getSetting(HISTORY_KEY);
    if (!raw) return [];
    const hist = JSON.parse(raw) as { at: number; action: string; snapshot: BrainOverrides }[];
    return hist.map((h) => ({ at: h.at, action: h.action, count: Object.keys(h.snapshot.items ?? {}).length }));
  } catch {
    return [];
  }
}

export async function revertTo(index: number): Promise<BrainOverrides> {
  const raw = await getRepo().getSetting(HISTORY_KEY);
  const hist = raw ? (JSON.parse(raw) as { at: number; action: string; snapshot: BrainOverrides }[]) : [];
  const target = hist[index];
  if (!target) throw new Error("גרסה לא נמצאה");
  const current = await loadOverrides();
  await pushHistory(current, "לפני חזרה לגרסה קודמת");
  const restored: BrainOverrides = { ...target.snapshot, version: current.version + 1, updatedAt: Date.now() };
  await saveOverrides(restored);
  return restored;
}

/** שמירת עריכה לפריט אחד. text ריק = מחיקת הדריסה וחזרה לברירת המחדל. */
export async function setOverride(id: string, text: string, base: string, note?: string): Promise<BrainOverrides> {
  const cur = await loadOverrides();
  await pushHistory(cur, text.trim() ? `עריכת ${id}` : `איפוס ${id}`);
  const items = { ...cur.items };
  if (!text.trim()) delete items[id];
  else items[id] = { id, text: text.trim(), base, updatedAt: Date.now(), note };
  const next: BrainOverrides = { items, version: cur.version + 1, updatedAt: Date.now() };
  await saveOverrides(next);
  return next;
}

/**
 * מחיל דריסות על טקסט הפרומפט. מחליף כל סעיף שנערך בטקסט החדש.
 * מחזיר גם רשימת דריסות מיושנות - כאלה שהטקסט המקורי שלהן כבר לא נמצא.
 */
export function applyPromptOverrides(
  prompt: string,
  overrides: BrainOverrides
): { prompt: string; applied: string[]; stale: string[] } {
  const applied: string[] = [];
  const stale: string[] = [];
  let out = prompt;
  for (const ov of Object.values(overrides.items)) {
    if (!ov.id.startsWith("rule-") && !ov.id.startsWith("sec-") && ov.id !== "intro") continue;
    if (!ov.base || !out.includes(ov.base)) {
      stale.push(ov.id);
      continue;
    }
    out = out.replace(ov.base, ov.text);
    applied.push(ov.id);
  }
  return { prompt: out, applied, stale };
}

/** הטקסט הערוך של תשובה חינמית, אם נערכה. */
export function cannedOverride(overrides: BrainOverrides, key: string): string | null {
  const ov = overrides.items[`canned-${key}`];
  return ov && ov.text.trim() ? ov.text : null;
}
