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
import { getRepo } from "../db";

const GRAPH_API_VERSION = "v21.0";

// ----- מטמון attachment_id: מטא מורידה כל מדיה פעם אחת ונותנת מזהה לשימוש חוזר,
//       כך שכל שליחה לאחר מכן מיידית (במקום שמטא תוריד את הסרטון בכל פעם). -----
const ATT_CACHE_KEY = "media_attachments"; // map: "channel|url" -> attachment_id

async function loadAttCache(): Promise<Record<string, string>> {
  try {
    const raw = await getRepo().getSetting(ATT_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function ensureAttachment(
  channel: Channel,
  tokenEnv: string,
  url: string,
  type: "image" | "video"
): Promise<string | undefined> {
  const token = process.env[tokenEnv];
  if (!token) return undefined;
  const key = `${channel}|${url}`;
  const cache = await loadAttCache();
  if (cache[key]) return cache[key];
  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/me/message_attachments?access_token=${token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: { attachment: { type, payload: { url, is_reusable: true } } } }),
      }
    );
    if (!res.ok) return undefined;
    const data = (await res.json()) as { attachment_id?: string };
    if (data.attachment_id) {
      const fresh = await loadAttCache();
      fresh[key] = data.attachment_id;
      await getRepo().setSetting(ATT_CACHE_KEY, JSON.stringify(fresh));
      return data.attachment_id;
    }
  } catch {
    /* נופלים חזרה לשליחה לפי URL */
  }
  return undefined;
}

/** חימום מראש: רושם מדיה אצל מטא (Messenger + Instagram) כדי שהשליחה ללקוח תהיה מיידית. */
export async function prewarmMediaAttachments(
  items: { url: string; type: "image" | "video" }[]
): Promise<void> {
  await Promise.all(
    items.flatMap((m) => [
      ensureAttachment("messenger", "MESSENGER_PAGE_ACCESS_TOKEN", m.url, m.type),
      ensureAttachment("instagram", "INSTAGRAM_PAGE_ACCESS_TOKEN", m.url, m.type),
    ])
  ).catch(() => {});
}

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
        attachments?: Array<{ type?: string; payload?: { url?: string } }>;
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
        if (ev.message?.is_echo || !ev.sender?.id) continue;
        if (ev.message?.text) {
          out.push({
            channel,
            senderId: ev.sender.id,
            text: ev.message.text,
            messageId: ev.message.mid,
            timestamp: ev.timestamp ?? Date.now(),
          });
        } else if (ev.message?.attachments?.length) {
          // הודעה קולית/אודיו - מטא נותן URL ישיר; נתמלל אותו ב-webhook
          const audio = ev.message.attachments.find((a) => a.type === "audio");
          if (audio?.payload?.url) {
            out.push({
              channel,
              senderId: ev.sender.id,
              text: "",
              audio: { url: audio.payload.url },
              messageId: ev.message.mid,
              timestamp: ev.timestamp ?? Date.now(),
            });
          }
        }
      }
    }
  } catch (err) {
    console.error(`[${channel}] failed to parse webhook:`, err);
  }
  return out;
}

function createAdapter(
  channel: Channel,
  tokenEnv: string,
  nameFields: string
): ChannelAdapter {
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
    async sendMedia(recipientId: string, url: string, type: "image" | "video"): Promise<void> {
      const token = process.env[tokenEnv];
      if (!token) throw new Error(`חסר ${tokenEnv}`);
      // שימוש ב-attachment_id ממטמון (מיידי) במקום הורדה מחדש של ה-URL בכל שליחה
      const attId = await ensureAttachment(channel, tokenEnv, url, type);
      const payload = attId ? { attachment_id: attId } : { url, is_reusable: true };
      const res = await fetch(endpoint(token), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: recipientId },
          messaging_type: "RESPONSE",
          message: { attachment: { type, payload } },
        }),
      });
      if (!res.ok) {
        throw new Error(`${channel} media failed (${res.status}): ${await res.text()}`);
      }
    },
    async getProfileName(userId: string): Promise<string | undefined> {
      const token = process.env[tokenEnv];
      if (!token) return undefined;
      try {
        const res = await fetch(
          `https://graph.facebook.com/${GRAPH_API_VERSION}/${userId}?fields=${nameFields}&access_token=${token}`
        );
        if (!res.ok) return undefined;
        const data = (await res.json()) as { name?: string; username?: string };
        return data.name || data.username || undefined;
      } catch {
        return undefined;
      }
    },
  };
}

// מסנג'ר: לצומת ה-PSID יש "name". אינסטגרם: ל-IGSID יש "name" ו-"username".
export const messengerAdapter = createAdapter("messenger", "MESSENGER_PAGE_ACCESS_TOKEN", "name");
export const instagramAdapter = createAdapter("instagram", "INSTAGRAM_PAGE_ACCESS_TOKEN", "name,username");
