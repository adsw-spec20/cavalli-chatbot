/**
 * תמלול הודעות קוליות באמצעות OpenAI Whisper.
 *
 * לקוחות (במיוחד בוואטסאפ) שולחים הרבה הודעות קוליות. כדי שהבוט "ישמע" אותן,
 * מורידים את קובץ האודיו מהערוץ ושולחים אותו ל-OpenAI לתמלול, ואז ממשיכים
 * בזרימה הרגילה כאילו הלקוח כתב את הטקסט.
 *
 * מופעל רק אם OPENAI_API_KEY מוגדר; אחרת מחזיר null (הבוט יבקש מהלקוח להקליד).
 * זיהוי השפה אוטומטי (Whisper) כדי לתמוך גם בלקוחות תיירים, לא רק עברית.
 *
 * משתני סביבה:
 *  - OPENAI_API_KEY   מפתח API של OpenAI (לתמלול בלבד)
 */

const OPENAI_TRANSCRIBE_URL = "https://api.openai.com/v1/audio/transcriptions";
const MODEL = "whisper-1";
const MAX_BYTES = 24 * 1024 * 1024; // מגבלת OpenAI ~25MB

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

  try {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: mime }), filename);
    form.append("model", MODEL);
    // verbose_json מחזיר גם no_speech_prob ו-avg_logprob לכל מקטע, כך שנוכל לזהות
    // רעש/הקלטה לא ברורה ולא "להמציא" תמלול (ולענות בשפה אקראית).
    form.append("response_format", "verbose_json");
    // רמז הקשר בעברית: מטה את התמלול לעברית ולמונחי בית הקפה (רוב ההקלטות בעברית).
    // לקוח שמדבר אנגלית ברור עדיין יתומלל באנגלית.
    form.append(
      "prompt",
      "שיחה עם נציג בית קפה בעברית. מונחים אפשריים: קפוצ'ינו, קרואסון, חניה, שעות פתיחה, הזמנת מקום, תפריט."
    );

    const res = await fetch(OPENAI_TRANSCRIBE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (!res.ok) {
      console.error(`[transcription] OpenAI נכשל (${res.status}): ${await res.text()}`);
      return null;
    }
    const data = (await res.json()) as {
      text?: string;
      segments?: Array<{ no_speech_prob?: number; avg_logprob?: number }>;
    };
    const text = (data.text ?? "").trim();
    if (!text) return null;

    // זיהוי הקלטה לא ברורה / רעש: אם ההסתברות ל"אין דיבור" גבוהה, או רמת הביטחון
    // נמוכה מאוד - מחזירים null (הבוט יבקש בעדינות בעברית להקליד), במקום לענות על תמלול-זבל.
    const segs = data.segments ?? [];
    if (segs.length) {
      const avgNoSpeech =
        segs.reduce((s, x) => s + (x.no_speech_prob ?? 0), 0) / segs.length;
      const avgLogprob =
        segs.reduce((s, x) => s + (x.avg_logprob ?? 0), 0) / segs.length;
      if (avgNoSpeech > 0.7 || avgLogprob < -1.2) {
        console.warn(
          `[transcription] הקלטה לא ברורה (no_speech=${avgNoSpeech.toFixed(2)}, logprob=${avgLogprob.toFixed(2)}) - מתעלם`
        );
        return null;
      }
    }
    return text;
  } catch (err) {
    console.error("[transcription] שגיאת תמלול:", err);
    return null;
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
