/**
 * WhatsApp adapter — מתחבר ל-WhatsApp Cloud API הרשמי של מטא.
 *
 * שני תפקידים:
 *  1. parseIncoming — ממיר webhook payload של מטא לפורמט האחיד שלנו.
 *  2. sendText — שולח הודעת טקסט חזרה ללקוח דרך Graph API.
 *
 * משתני סביבה נדרשים (ראה .env.example):
 *  - WHATSAPP_PHONE_NUMBER_ID   מזהה מספר הטלפון העסקי (מ-Meta)
 *  - WHATSAPP_ACCESS_TOKEN      טוקן גישה (מ-Meta)
 */

import type {
  ChannelAdapter,
  IncomingMessage,
} from "./types";
import { transcribeAudio } from "../transcription";

const GRAPH_API_VERSION = "v21.0";

/**
 * ממיר את ה-payload של webhook מ-WhatsApp להודעות מנורמלות.
 * payload של מטא יכול להכיל כמה הודעות; מחזירים את כולן (בד"כ אחת).
 * הודעות שאינן טקסט (תמונה/סטיקר וכו') מסוננות בשלב זה.
 */
export function parseIncoming(payload: unknown): IncomingMessage[] {
  const messages: IncomingMessage[] = [];

  try {
    const body = payload as WhatsAppWebhookBody;
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        // שם השולח מגיע בתוך contacts שב-payload (לפי wa_id)
        const nameByWaId = new Map<string, string>();
        for (const c of value?.contacts ?? []) {
          if (c.wa_id && c.profile?.name) nameByWaId.set(c.wa_id, c.profile.name);
        }
        for (const msg of value?.messages ?? []) {
          const ts = msg.timestamp ? parseInt(msg.timestamp, 10) * 1000 : Date.now();
          if (msg.type === "text" && msg.text?.body) {
            messages.push({
              channel: "whatsapp",
              senderId: msg.from,
              senderName: nameByWaId.get(msg.from),
              text: msg.text.body,
              messageId: msg.id,
              timestamp: ts,
            });
          } else if ((msg.type === "audio" || msg.type === "voice") && msg.audio?.id) {
            // הודעה קולית - נתמלל אותה אחר כך (ב-webhook), כאן רק מסמנים את ה-mediaId
            messages.push({
              channel: "whatsapp",
              senderId: msg.from,
              senderName: nameByWaId.get(msg.from),
              text: "",
              audio: { mediaId: msg.audio.id, mime: msg.audio.mime_type },
              messageId: msg.id,
              timestamp: ts,
            });
          }
        }
      }
    }
  } catch (err) {
    console.error("[whatsapp] failed to parse webhook payload:", err);
  }

  return messages;
}

/**
 * מוריד הודעה קולית מוואטסאפ ומתמלל אותה.
 * וואטסאפ Cloud API לא נותן URL ישיר - צריך שני שלבים:
 *  1. GET /{media_id}  -> מחזיר כתובת הורדה זמנית.
 *  2. GET על הכתובת (עם אותו טוקן) -> מוריד את הבייטים בפועל.
 * מחזיר את הטקסט המתומלל, או null אם נכשל.
 */
export async function transcribeWhatsAppAudio(mediaId: string): Promise<string | null> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!accessToken) return null;
  try {
    const metaRes = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!metaRes.ok) {
      console.error(`[whatsapp] שליפת מטא-דאטה של אודיו נכשלה (${metaRes.status})`);
      return null;
    }
    const metaData = (await metaRes.json()) as { url?: string; mime_type?: string };
    if (!metaData.url) return null;

    const fileRes = await fetch(metaData.url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!fileRes.ok) {
      console.error(`[whatsapp] הורדת אודיו נכשלה (${fileRes.status})`);
      return null;
    }
    const bytes = await fileRes.arrayBuffer();
    const mime = metaData.mime_type?.split(";")[0] || "audio/ogg";
    return transcribeAudio(bytes, "audio.ogg", mime);
  } catch (err) {
    console.error("[whatsapp] תמלול הודעה קולית נכשל:", err);
    return null;
  }
}

export const whatsappAdapter: ChannelAdapter = {
  channel: "whatsapp",

  async sendText(recipientId: string, text: string): Promise<void> {
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

    if (!phoneNumberId || !accessToken) {
      throw new Error(
        "חסרים WHATSAPP_PHONE_NUMBER_ID או WHATSAPP_ACCESS_TOKEN ב-.env.local"
      );
    }

    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipientId,
        type: "text",
        text: { body: text },
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`WhatsApp send failed (${res.status}): ${errBody}`);
    }
  },

  async sendMedia(recipientId: string, url: string, type: "image" | "video", mime?: string): Promise<void> {
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    if (!phoneNumberId || !accessToken) {
      throw new Error("חסרים WHATSAPP_PHONE_NUMBER_ID או WHATSAPP_ACCESS_TOKEN");
    }
    // וואטסאפ מקבל כסרטון רק mp4/3gpp - סרטון אייפון (video/quicktime) נדחה,
    // ובאיחור (דרך webhook סטטוס, אחרי שה-API כבר ענה 200). לכן פורמט אחר
    // נשלח מראש כמסמך: עובר תמיד, והלקוח מנגן אותו בלחיצה.
    const unsupportedVideo =
      type === "video" && !!mime && !/video\/(mp4|3gpp)/i.test(mime);
    const body = unsupportedVideo
      ? {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: recipientId,
          type: "document",
          document: { link: url, filename: "video.mov" },
        }
      : type === "video"
        ? { messaging_product: "whatsapp", recipient_type: "individual", to: recipientId, type: "video", video: { link: url } }
        : { messaging_product: "whatsapp", recipient_type: "individual", to: recipientId, type: "image", image: { link: url } };
    const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`WhatsApp media failed (${res.status}): ${await res.text()}`);
    }
  },
};

// ---- טיפוסים חלקיים של מבנה ה-webhook של מטא (רק מה שאנחנו צורכים) ----

interface WhatsAppWebhookBody {
  entry?: Array<{
    changes?: Array<{
      value?: {
        contacts?: Array<{
          wa_id?: string;
          profile?: { name?: string };
        }>;
        messages?: Array<{
          from: string;
          id: string;
          timestamp?: string;
          type: string;
          text?: { body: string };
          audio?: { id: string; mime_type?: string; voice?: boolean };
        }>;
        statuses?: Array<{
          id: string;
          recipient_id?: string;
          status?: string;
          timestamp?: string;
          errors?: Array<{ code?: number; title?: string; message?: string; error_data?: { details?: string } }>;
        }>;
      };
    }>;
  }>;
}

/** סטטוס מסירה של הודעה שאנחנו שלחנו (מטא שולחת אותו ב-webhook נפרד). */
export interface DeliveryStatus {
  /** מזהה ההודעה שנשלחה (wamid) */
  messageId: string;
  /** למי נשלחה */
  recipientId?: string;
  /** sent / delivered / read / failed */
  status: string;
  /** תיאור התקלה כשהסטטוס failed */
  error?: string;
  timestamp: number;
}

/**
 * חילוץ סטטוסי מסירה. בלי זה הודעה יוצאת שמטא קיבלה (200) אבל לא הצליחה
 * למסור נעלמת בשקט - הפאנל מציג "נשלח" והלקוח לא קיבל כלום.
 */
export function parseStatuses(payload: unknown): DeliveryStatus[] {
  const out: DeliveryStatus[] = [];
  try {
    const body = payload as WhatsAppWebhookBody;
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const s of change.value?.statuses ?? []) {
          if (!s.id || !s.status) continue;
          const e = s.errors?.[0];
          out.push({
            messageId: s.id,
            recipientId: s.recipient_id,
            status: s.status,
            error: e
              ? [e.code ? `[${e.code}]` : "", e.title, e.message, e.error_data?.details]
                  .filter(Boolean)
                  .join(" ")
                  .trim()
              : undefined,
            timestamp: s.timestamp ? parseInt(s.timestamp, 10) * 1000 : Date.now(),
          });
        }
      }
    }
  } catch (err) {
    console.error("[whatsapp] failed to parse statuses:", err);
  }
  return out;
}
