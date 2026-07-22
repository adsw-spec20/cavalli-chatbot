/**
 * ספריית מדיה - תמונות/סרטונים שהבוט יכול לשלוח ללקוחות.
 *
 * כל פריט מכיל כתובת (URL ציבורי), תווית ומילות מפתח. הבוט מקבל את הרשימה
 * ב-System Prompt ויכול לבחור לשלוח פריט רלוונטי (דרך הכלי send_media), למשל
 * סרטון חניה כששואלים איך מגיעים, או תמונת מנה כששואלים עליה.
 *
 * נשמר ב-DB (settings, מפתח "media_library").
 */

import { getRepo } from "./db";

export interface MediaItem {
  id: string;
  /** שם ידידותי ("סרטון הדרך לחניה", "גינת הילדים"). */
  label: string;
  /** מילות מפתח שעוזרות לבוט להבין מתי זה רלוונטי ("חניה, איך מגיעים"). */
  keywords: string;
  /** כתובת ציבורית של התמונה/סרטון. */
  url: string;
  type: "image" | "video";
}

const KEY = "media_library";

export async function loadMedia(): Promise<MediaItem[]> {
  try {
    const raw = await getRepo().getSetting(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export async function saveMedia(items: MediaItem[]): Promise<void> {
  await getRepo().setSetting(KEY, JSON.stringify(items));
}

// מילים נפוצות מדי מכדי להעיד על רלוונטיות (כדי לא להתאים בטעות)
const MEDIA_STOPWORDS = new Set(["של", "עם", "או", "גם", "את", "כל", "זה", "יש"]);

/** נרמול עברי קל להשוואת מילים: אותיות קטנות, בלי גרשיים, וכיווץ כפילויות איות. */
function normalizeHe(s: string): string {
  return s
    .toLowerCase()
    .replace(/["'`׳״]/g, "")
    .replace(/יי/g, "י") // חנייה -> חניה
    .replace(/וו/g, "ו");
}

/**
 * האם פריט המדיה באמת רלוונטי לטקסט של הלקוח?
 * בלם דטרמיניסטי: גם אם המודל ביקש לשלוח מדיה, נשלח רק אם מילת מפתח (או מילה
 * מהתווית, כשאין מילות מפתח) של הפריט מופיעה בשאלת הלקוח. כך למשל סרטון החניה
 * נשלח רק כששואלים על חניה, ולא מצורף סתם לשאלה אחרת.
 */
export function isMediaRelevant(item: MediaItem, text: string): boolean {
  const hay = normalizeHe(text || "");
  if (!hay) return false;
  const source = item.keywords?.trim() ? item.keywords : item.label;
  const tokens = normalizeHe(source)
    .split(/[\s,.;:!?()/\-]+/)
    .filter((t) => t.length >= 2 && !MEDIA_STOPWORDS.has(t));
  return tokens.some((t) => hay.includes(t));
}
