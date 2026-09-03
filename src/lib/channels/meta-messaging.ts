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
            // תבניות מודעה פגומות שולחות לפעמים קידומת "null " לפני הטקסט - מסננים
            text: ev.message.text.replace(/^\s*null\s+/i, ""),
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
    async sendText(recipientId: string, text: string, opts?: { humanAgent?: boolean }): Promise<void> {
      const token = process.env[tokenEnv];
      if (!token) throw new Error(`חסר ${tokenEnv} ב-.env.local`);
      const attempt = (body: Record<string, unknown>) =>
        fetch(endpoint(token), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipient: { id: recipientId }, message: { text }, ...body }),
        });

      const res = await attempt({ messaging_type: "RESPONSE" });
      if (res.ok) return;
      const errText = await res.text();

      // חלון 24 השעות של מטא נסגר (code 10 / subcode 2534022).
      // תשובת נציג אנושי: מנסים שוב עם תג HUMAN_AGENT שמרחיב את החלון ל-7 ימים
      // (עובד רק אחרי שמטא מאשרת את פיצ'ר Human Agent לאפליקציה).
      const windowClosed = errText.includes("2534022") || /"code"\s*:\s*10\b/.test(errText);
      if (windowClosed && opts?.humanAgent) {
        const retry = await attempt({ messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" });
        if (retry.ok) return;
        throw new Error(
          "מטא חוסמת שליחה מעבר ל-24 שעות מההודעה האחרונה של הלקוח. " +
            "ברגע שבקשת Human Agent שהגשנו תאושר, נציגים יוכלו לענות עד 7 ימים אחורה. " +
            "בינתיים: אם יש טלפון של הלקוח - עדיף להתקשר."
        );
      }
      if (windowClosed) {
        throw new Error("מטא חוסמת שליחה מעבר ל-24 שעות מההודעה האחרונה של הלקוח.");
      }
      throw new Error(`${channel} send failed (${res.status}): ${errText}`);
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
      // אינסטגרם (3.9): endpoint העלאת ה-attachments ו-is_reusable קיימים רק
      // במסנג'ר - שליחתם לאינסטגרם נדחית, וזה מה שמנע צירוף תמונות שם.
      // באינסטגרם שולחים url ישיר בלי הפרמטרים האלה.
      const attId =
        channel === "instagram" ? undefined : await ensureAttachment(channel, tokenEnv, url, type);
      const payload = attId
        ? { attachment_id: attId }
        : channel === "instagram"
          ? { url }
          : { url, is_reusable: true };
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
        if (!res.ok) {
          console.error(`[${channel}] שליפת שם פרופיל נכשלה (${res.status}):`, await res.text());
          return undefined;
        }
        const data = (await res.json()) as {
          name?: string;
          username?: string;
          first_name?: string;
          last_name?: string;
        };
        // מסנג'ר מחזיר first_name/last_name (השדה name לא נתמך ל-PSID);
        // אינסטגרם מחזיר name/username.
        const fullName = [data.first_name, data.last_name].filter(Boolean).join(" ");
        return data.name || fullName || data.username || undefined;
      } catch {
        return undefined;
      }
    },
  };
}

// מסנג'ר: ל-PSID אין שדה "name" - חובה לבקש first_name+last_name (זו הייתה
// הסיבה שכל לקוחות הפייסבוק הופיעו כ"לקוח"). אינסטגרם: "name" ו-"username".
export const messengerAdapter = createAdapter(
  "messenger",
  "MESSENGER_PAGE_ACCESS_TOKEN",
  "first_name,last_name"
);
export const instagramAdapter = createAdapter("instagram", "INSTAGRAM_PAGE_ACCESS_TOKEN", "name,username");
