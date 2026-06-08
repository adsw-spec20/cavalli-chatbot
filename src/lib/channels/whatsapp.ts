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
        for (const msg of value?.messages ?? []) {
          if (msg.type === "text" && msg.text?.body) {
            messages.push({
              channel: "whatsapp",
              senderId: msg.from,
              text: msg.text.body,
              messageId: msg.id,
              timestamp: msg.timestamp
                ? parseInt(msg.timestamp, 10) * 1000
                : Date.now(),
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
};

// ---- טיפוסים חלקיים של מבנה ה-webhook של מטא (רק מה שאנחנו צורכים) ----

interface WhatsAppWebhookBody {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          from: string;
          id: string;
          timestamp?: string;
          type: string;
          text?: { body: string };
        }>;
      };
    }>;
  }>;
}
