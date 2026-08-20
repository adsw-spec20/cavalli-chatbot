/**
 * תמלול הודעות קוליות באמצעות OpenAI.
 *
 * לקוחות (במיוחד בוואטסאפ) שולחים הרבה הודעות קוליות. כדי שהבוט "ישמע" אותן,
 * מורידים את קובץ האודיו מהערוץ ושולחים אותו ל-OpenAI לתמלול, ואז ממשיכים
 * בזרימה הרגילה כאילו הלקוח כתב את הטקסט.
 *
 * מודל ראשי: gpt-4o-transcribe (דיוק גבוה משמעותית בעברית מ-whisper-1 - הוחלף
 * אחרי תמלולים שגויים בהקלטות אמיתיות); נפילה אוטומטית ל-whisper-1 אם נכשל.
 *
 * מופעל רק אם OPENAI_API_KEY מוגדר; אחרת מחזיר null (הבוט יבקש מהלקוח להקליד).
 * זיהוי השפה אוטומטי כדי לתמוך גם בלקוחות תיירים, לא רק עברית.
 *
 * משתני סביבה:
 *  - OPENAI_API_KEY   מפתח API של OpenAI (לתמלול בלבד)
 */

import { recordTranscription } from "./usage";

const OPENAI_TRANSCRIBE_URL = "https://api.openai.com/v1/audio/transcriptions";
const PRIMARY_MODEL = "gpt-4o-transcribe";
const FALLBACK_MODEL = "whisper-1";
const MAX_BYTES = 24 * 1024 * 1024; // מגבלת OpenAI ~25MB

// רמז הקשר בעברית: מטה את התמלול לעברית, למונחי בית הקפה ולבקשות שירות נפוצות
// (רוב ההקלטות בעברית). לקוח שמדבר אנגלית ברור עדיין יתומלל באנגלית.
const CONTEXT_PROMPT =
  "הודעה קולית של לקוח לבית קפה בישראל, בעברית מדוברת. נושאים נפוצים: " +
  "קפוצ'ינו, קרואסון, חניה, שעות פתיחה, הזמנת מקום, תפריט, יום הולדת, " +
  "לדבר עם נציג, שיתקשרו אליי, אפשר לא רובוט, תגיד להם.";

/**
 * מתמלל מערך בייטים של אודיו לטקסט. מחזיר את הטקסט, או null אם לא הצליח
 * (אין מפתח, קובץ ריק/גדול מדי, או שגיאת רשת/API).
 */
export async function transcribeAudio(
  bytes: ArrayBuffer,
  filename = "audio.ogg",
  mime = "audio/ogg"
): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[transcription] OPENAI_API_KEY חסר - מדלג על תמלול קולי");
    return null;
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
    console.warn(`[transcription] גודל אודיו לא תקין: ${bytes.byteLength} בייט`);
    return null;
  }
  const primary = await transcribeWith(PRIMARY_MODEL, apiKey, bytes, filename, mime);
  if (primary !== "error") return primary; // טקסט תקין, או null מכוון (רעש)
  console.warn(`[transcription] ${PRIMARY_MODEL} נכשל - נופל ל-${FALLBACK_MODEL}`);
  const fallback = await transcribeWith(FALLBACK_MODEL, apiKey, bytes, filename, mime);
  return fallback === "error" ? null : fallback;
}

/**
 * קריאה אחת למודל תמלול. מחזיר: טקסט | null (הקלטה לא ברורה - אין טעם לנסות
 * מודל אחר) | "error" (כשל API - שווה לנסות את מודל הגיבוי).
 */
async function transcribeWith(
  model: string,
  apiKey: string,
  bytes: ArrayBuffer,
  filename: string,
  mime: string
): Promise<string | null | "error"> {
  try {
    const isWhisper = model === FALLBACK_MODEL;
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: mime }), filename);
    form.append("model", model);
    form.append("prompt", CONTEXT_PROMPT);
    if (isWhisper) {
      // verbose_json מחזיר no_speech_prob ו-avg_logprob לכל מקטע - זיהוי רעש
      form.append("response_format", "verbose_json");
    } else {
      // gpt-4o-transcribe לא תומך ב-verbose_json; logprobs נותנים מדד ביטחון
      form.append("response_format", "json");
      form.append("include[]", "logprobs");
    }

    const res = await fetch(OPENAI_TRANSCRIBE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      console.error(`[transcription] ${model} נכשל (${res.status}): ${await res.text()}`);
      return "error";
    }
    const data = (await res.json()) as {
      text?: string;
      duration?: number;
      segments?: Array<{ no_speech_prob?: number; avg_logprob?: number }>;
      logprobs?: Array<{ logprob?: number }>;
      usage?: { seconds?: number };
    };
    // רישום עלות התמלול (מחויב לפי אורך האודיו, גם אם נדחה כרעש).
    // כשאין נתון מדויק - הערכה לפי גודל הקובץ (~2KB לשנייה בקידוד קולי).
    const seconds = data.duration ?? data.usage?.seconds ?? Math.max(1, Math.round(bytes.byteLength / 2000));
    await recordTranscription(seconds);
    const text = (data.text ?? "").trim();
    if (!text) return null;

    // זיהוי הקלטה לא ברורה / רעש: ביטחון נמוך -> null (הבוט יבקש בעדינות להקליד),
    // במקום לענות על תמלול-זבל.
    if (isWhisper) {
      const segs = data.segments ?? [];
      if (segs.length) {
        const avgNoSpeech = segs.reduce((s, x) => s + (x.no_speech_prob ?? 0), 0) / segs.length;
        const avgLogprob = segs.reduce((s, x) => s + (x.avg_logprob ?? 0), 0) / segs.length;
        if (avgNoSpeech > 0.7 || avgLogprob < -1.2) {
          console.warn(
            `[transcription] הקלטה לא ברורה (no_speech=${avgNoSpeech.toFixed(2)}, logprob=${avgLogprob.toFixed(2)}) - מתעלם`
          );
          return null;
        }
      }
    } else {
      const lps = (data.logprobs ?? []).map((l) => l.logprob ?? 0);
      if (lps.length) {
        const avg = lps.reduce((s, x) => s + x, 0) / lps.length;
        console.log(`[transcription] ${model} ביטחון avg_logprob=${avg.toFixed(2)} ("${text.slice(0, 60)}")`);
        if (avg < -1.2) {
          console.warn(`[transcription] ביטחון נמוך (${avg.toFixed(2)}) - מתעלם מהתמלול`);
          return null;
        }
      }
    }
    return text;
  } catch (err) {
    console.error(`[transcription] שגיאת תמלול (${model}):`, err);
    return "error";
  }
}

/**
 * הגנת SSRF: ה-URL מגיע מ-payload של webhook. גם עם אימות חתימה, לא מושכים
 * כתובות פנימיות - רק https לשם מארח ציבורי (לא IP, לא localhost).
 */
export function isSafeMediaUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
    // חסימת IP literal (IPv4/IPv6) - כולל כתובות metadata פנימיות של ענן
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * מוריד אודיו מכתובת URL (Messenger/Instagram מספקים URL ישיר לקובץ) ומתמלל.
 * authHeader אופציונלי - אם הערוץ דורש טוקן להורדה.
 */
export async function transcribeFromUrl(
  url: string,
  authHeader?: string
): Promise<string | null> {
  if (!isSafeMediaUrl(url)) {
    console.error("[transcription] כתובת אודיו נחסמה (לא בטוחה):", url.slice(0, 100));
    return null;
  }
  try {
    const res = await fetch(
      url,
      authHeader ? { headers: { Authorization: authHeader } } : undefined
    );
    if (!res.ok) {
      console.error(`[transcription] הורדת אודיו מ-URL נכשלה (${res.status})`);
      return null;
    }
    const mime = res.headers.get("content-type") || "audio/mpeg";
    const bytes = await res.arrayBuffer();
    const ext = mime.includes("mp4") || mime.includes("m4a")
      ? "m4a"
      : mime.includes("ogg")
        ? "ogg"
        : mime.includes("wav")
          ? "wav"
          : "mp3";
    return transcribeAudio(bytes, `audio.${ext}`, mime);
  } catch (err) {
    console.error("[transcription] הורדת אודיו נכשלה:", err);
    return null;
  }
}
