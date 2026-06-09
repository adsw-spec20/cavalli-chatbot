/**
 * מתאמים ל-Messenger ול-Instagram DM. שניהם דרך ה-Graph API של Meta (Send API),
 * עם אותו מבנה בדיוק, אז הם חולקים את אותו קוד עם טוקן/ערוץ שונה.
 *
 * משתני סביבה:
 *  - MESSENGER_PAGE_ACCESS_TOKEN  טוקן עמוד הפייסבוק (Messenger)
 *  - INSTAGRAM_PAGE_ACCESS_TOKEN  טוקן העמוד המקושר לאינסטגרם
 *  (אם זה אותו עמוד, יכול להיות אותו טוקן.)
 */

import type { Channel, ChannelAdapter, IncomingMessage } from "./types";

const GRAPH_API_VERSION = "v21.0";

interface MetaWebhookBody {
  object?: string;
  entry?: Array<{
    messaging?: Array<{
      sender?: { id: string };
      recipient?: { id: string };
      timestamp?: number;
      message?: {
        text?: string;
        is_echo?: boolean;
        mid?: string;
      };
    }>;
  }>;
}

/**
 * ממיר webhook של Messenger/Instagram להודעות מנורמלות.
 * מסנן הדים (echo) של הודעות שאנחנו עצמנו שלחנו.
 */
export function parseMetaMessaging(
  payload: unknown,
  channel: "messenger" | "instagram"
): IncomingMessage[] {
  const out: IncomingMessage[] = [];
  try {
    const body = payload as MetaWebhookBody;
    for (const entry of body.entry ?? []) {
      for (const ev of entry.messaging ?? []) {
        if (ev.message?.text && !ev.message.is_echo && ev.sender?.id) {
          out.push({
            channel,
            senderId: ev.sender.id,
            text: ev.message.text,
            messageId: ev.message.mid,
            timestamp: ev.timestamp ?? Date.now(),
          });
        }
      }
    }
  } catch (err) {
    console.error(`[${channel}] failed to parse webhook:`, err);
  }
  return out;
}

function createAdapter(channel: Channel, tokenEnv: string): ChannelAdapter {
  const endpoint = (token: string) =>
    `https://graph.facebook.com/${GRAPH_API_VERSION}/me/messages?access_token=${token}`;

  return {
    channel,
    async sendText(recipientId: string, text: string): Promise<void> {
      const token = process.env[tokenEnv];
      if (!token) throw new Error(`חסר ${tokenEnv} ב-.env.local`);
      const res = await fetch(endpoint(token), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: recipientId },
          messaging_type: "RESPONSE",
          message: { text },
        }),
      });
      if (!res.ok) {
        throw new Error(`${channel} send failed (${res.status}): ${await res.text()}`);
      }
    },
    async sendTyping(recipientId: string): Promise<void> {
      const token = process.env[tokenEnv];
      if (!token) return;
      await fetch(endpoint(token), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: recipientId },
          sender_action: "typing_on",
        }),
      }).catch(() => {});
    },
  };
}

export const messengerAdapter = createAdapter("messenger", "MESSENGER_PAGE_ACCESS_TOKEN");
export const instagramAdapter = createAdapter("instagram", "INSTAGRAM_PAGE_ACCESS_TOKEN");
