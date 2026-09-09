/**
 * קליטת מדיה שלקוחות שולחים (תמונה / סרטון / מסמך).
 *
 * למה המודול הזה קיים: עד 9.9 הודעות מדיה נכנסות נזרקו בשקט כבר בשלב הפענוח
 * של הערוץ - לקוחה ששלחה צילום קבלה קיבלה שתיקה מלאה, והנציגה נאלצה לבקש
 * ממנה שוב מידע שכבר נשלח. כאן אנחנו מורידים את הקובץ, מאמתים אותו, ומעתיקים
 * אותו ל-Blob שלנו כדי שהצוות יראה אותו בפאנל.
 *
 * למה חייבים להעתיק ולא לשמור את הכתובת המקורית: וואטסאפ בכלל לא נותן כתובת
 * (רק mediaId שדורש טוקן), והכתובות של מטא פגות תוך זמן קצר. שמירת הכתובת
 * המקורית הייתה נותנת לצוות תמונה שבורה כעבור יום.
 *
 * עקרון מנחה: כשלון כאן לעולם לא מפיל את השיחה. אם ההורדה נכשלה הלקוח עדיין
 * מקבל מענה, והצוות רואה שהגיע קובץ שלא הצלחנו לשמור - עדיף מאשר שתיקה.
 */

import { isSafeMediaUrl } from "./transcription";
import type { IncomingMediaRef } from "./channels/types";

/** קובץ שנשמר בהצלחה, בפורמט שהפאנל יודע להציג */
export interface StoredIncomingMedia {
  /**
   * הכתובת שהוחזרה מ-Blob. בקבצים פרטיים היא אינה נגישה מהדפדפן, ומשמשת רק
   * לתיעוד ולמחיקה. התצוגה בפאנל עוברת דרך pathname (ראה admin-service).
   */
  url: string;
  /**
   * הנתיב בתוך ה-store. זה מה שמאפשר לשרת לשלוף את הקובץ הפרטי ולהזרים אותו
   * לפאנל. רשומות ישנות (לפני המעבר לפרטי, 9.9) לא מכילות אותו, ואז נופלים
   * לכתובת הציבורית שב-url.
   */
  pathname?: string;
  type: "image" | "video" | "document";
  /** שם/תיאור לתצוגה מתחת לקובץ */
  label?: string;
}

/** תקרה שמרנית: מונעת שגם סרטון ארוך מהטלפון לא יתקע את ה-webhook */
const MAX_BYTES = 20 * 1024 * 1024;

/** זהה לקבוע שבאדפטרים של הערוצים - שדרוג גרסה צריך לקרות בשלושתם יחד */
const GRAPH_API_VERSION = "v21.0";

/**
 * רשימת היתר לפי סוג תוכן. מה שלא ברשימה לא נשמר - הצוות פותח את זה בדפדפן,
 * ואנחנו לא רוצים להגיש קבצים שרירותיים מכתובת שלנו.
 */
const ALLOWED_MIME =
  /^(image\/(jpeg|jpg|png|gif|webp|heic|heif)|video\/(mp4|quicktime|3gpp|webm)|application\/pdf)$/i;

/** סיווג לפי ה-mime בפועל, ולא לפי מה שהערוץ הצהיר */
function typeFromMime(mime: string): "image" | "video" | "document" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

function extFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("png")) return "png";
  if (m.includes("gif")) return "gif";
  if (m.includes("webp")) return "webp";
  if (m.includes("heic")) return "heic";
  if (m.includes("heif")) return "heif";
  if (m.includes("quicktime")) return "mov";
  if (m.includes("3gpp")) return "3gp";
  if (m.includes("webm")) return "webm";
  if (m.includes("mp4")) return "mp4";
  if (m.includes("pdf")) return "pdf";
  return "bin";
}

/** תווית קריאה לצוות לפי סוג הקובץ */
export function mediaLabel(type: "image" | "video" | "document"): string {
  return type === "image" ? "📷 תמונה" : type === "video" ? "🎥 סרטון" : "📄 מסמך";
}

/**
 * טקסט מציין להודעה שאין בה מילים - כדי שהמוח יקבל משהו לעבוד איתו במקום
 * להיעצר על טקסט ריק, וכדי שבפאנל תופיע שורה ולא בועה ריקה.
 */
export function describeIncomingMedia(items: { type: "image" | "video" | "document" }[]): string {
  if (!items.length) return "";
  if (items.length === 1) return `[הלקוח שלח ${mediaLabel(items[0].type).replace(/^\S+\s/, "")}]`;
  return `[הלקוח שלח ${items.length} קבצים]`;
}

/** מוריד בייטים מכתובת, עם תקרת גודל ובדיקת כתובת בטוחה */
async function fetchBytes(
  url: string,
  authHeader?: string
): Promise<{ bytes: ArrayBuffer; mime: string } | null> {
  if (!isSafeMediaUrl(url)) {
    console.error("[incoming-media] כתובת לא בטוחה נדחתה");
    return null;
  }
  const res = await fetch(url, authHeader ? { headers: { Authorization: authHeader } } : undefined);
  if (!res.ok) {
    console.error(`[incoming-media] הורדה נכשלה (${res.status})`);
    return null;
  }
  // בדיקת גודל מוקדמת לפי הכותרת, לפני שמושכים את הבייטים לזיכרון
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared && declared > MAX_BYTES) {
    console.error(`[incoming-media] קובץ גדול מדי (${Math.round(declared / 1024 / 1024)}MB)`);
    return null;
  }
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) {
    console.error(`[incoming-media] קובץ גדול מדי אחרי הורדה (${bytes.byteLength} bytes)`);
    return null;
  }
  const mime = (res.headers.get("content-type") || "").split(";")[0].trim();
  return { bytes, mime };
}

/**
 * וואטסאפ לא נותן כתובת ישירה: קודם GET /{media_id} שמחזיר כתובת זמנית,
 * ואז הורדה ממנה עם אותו טוקן. אותו דפוס כמו בתמלול הודעות קוליות.
 */
async function fetchWhatsAppMedia(
  mediaId: string
): Promise<{ bytes: ArrayBuffer; mime: string } | null> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) return null;
  const metaRes = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!metaRes.ok) {
    console.error(`[incoming-media] שליפת מטא-דאטה נכשלה (${metaRes.status})`);
    return null;
  }
  const meta = (await metaRes.json()) as { url?: string; mime_type?: string };
  if (!meta.url) return null;
  const file = await fetchBytes(meta.url, `Bearer ${token}`);
  if (!file) return null;
  // ה-mime מה-Graph מדויק יותר מכותרת ההורדה (שלפעמים גנרית)
  return { bytes: file.bytes, mime: meta.mime_type?.split(";")[0].trim() || file.mime };
}

/**
 * מעלה קובץ ל-Blob באחסון **פרטי**.
 *
 * למה פרטי ולא ציבורי: אלה קבצים של לקוחות - קבלות, חשבוניות, צילומי מסך של
 * תכתובות. אחסון ציבורי עם כתובת אקראית היה "קשה לניחוש" אבל לא מוגן: כל מי
 * שהכתובת מגיעה אליו (העברה בוואטסאפ, היסטוריית דפדפן, לוג) פותח את הקובץ בלי
 * שום הזדהות. באחסון פרטי הקובץ נגיש רק לשרת שלנו, והפאנל מקבל אותו דרך
 * /api/admin/incoming-media שמאחורי שער ההתחברות.
 */
async function uploadToBlob(
  bytes: ArrayBuffer,
  mime: string,
  hint: string
): Promise<{ url: string; pathname: string } | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) {
    console.error("[incoming-media] אין הגדרות Blob - הקובץ לא נשמר");
    return null;
  }
  try {
    const { put } = await import("@vercel/blob");
    const safeHint = hint.replace(/[^\w.\-]/g, "").slice(0, 40) || "file";
    const day = new Date().toISOString().slice(0, 10);
    const blob = await put(`incoming/${day}/${safeHint}.${extFromMime(mime)}`, bytes, {
      access: "private",
      addRandomSuffix: true,
      contentType: mime,
    });
    return { url: blob.url, pathname: blob.pathname };
  } catch (err) {
    console.error("[incoming-media] העלאה ל-Blob נכשלה:", err);
    return null;
  }
}

/**
 * הזרימה המלאה עבור הודעה אחת: הורדה, אימות, העתקה ל-Blob.
 *
 * מחזיר גם את מה שנשמר וגם כמה נכשלו, כדי שהצוות יראה בפאנל שהגיע קובץ
 * שלא הצלחנו לשמור במקום שהוא ייעלם בלי זכר.
 */
export async function ingestIncomingMedia(
  refs: IncomingMediaRef[]
): Promise<{ stored: StoredIncomingMedia[]; failed: number }> {
  const stored: StoredIncomingMedia[] = [];
  let failed = 0;

  for (const ref of refs) {
    try {
      const file = ref.mediaId
        ? await fetchWhatsAppMedia(ref.mediaId)
        : ref.url
        ? await fetchBytes(ref.url)
        : null;

      if (!file) {
        failed++;
        continue;
      }
      const mime = file.mime || ref.mime || "";
      if (!ALLOWED_MIME.test(mime)) {
        console.error(`[incoming-media] סוג קובץ לא נתמך נדחה: ${mime || "לא ידוע"}`);
        failed++;
        continue;
      }
      const type = typeFromMime(mime);
      const uploaded = await uploadToBlob(file.bytes, mime, ref.filename || type);
      if (!uploaded) {
        failed++;
        continue;
      }
      stored.push({
        url: uploaded.url,
        pathname: uploaded.pathname,
        type,
        label: ref.filename || mediaLabel(type),
      });
    } catch (err) {
      console.error("[incoming-media] קליטת קובץ נכשלה:", err);
      failed++;
    }
  }

  return { stored, failed };
}
