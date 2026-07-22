/**
 * לוגיקת webhook משותפת ל-Messenger ולאינסטגרם (אותו פרוטוקול של Meta).
 *  GET  - אימות מול Meta (verify token).
 *  POST - קבלת הודעות: אימות חתימה, הצגת "מקליד...", מענה דרך המוח.
 */

import { NextRequest, NextResponse, after } from "next/server";
import { handleIncomingMessage } from "./conversation-service";
import { maybeUpdateCustomerMemory } from "./customer-memory";
import { parseMetaMessaging } from "./channels/meta-messaging";
import { verifyMetaSignature } from "./meta-signature";
import { transcribeFromUrl } from "./transcription";
import type { ChannelAdapter } from "./channels/types";

export function handleVerify(req: NextRequest, verifyToken: string): NextResponse {
  const p = req.nextUrl.searchParams;
  // verify token ריק (env לא מוגדר) = דחייה, אחרת כל אחד יכול "לאמת" את ה-webhook
  if (
    verifyToken &&
    p.get("hub.mode") === "subscribe" &&
    p.get("hub.verify_token") === verifyToken
  ) {
    return new NextResponse(p.get("hub.challenge"), { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

export async function handleReceive(
  req: NextRequest,
  channel: "messenger" | "instagram",
  adapter: ChannelAdapter
): Promise<NextResponse> {
  const raw = await req.text();
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "bad signature" }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true });
  }

  const incoming = parseMetaMessaging(payload, channel);

  // מחזירים 200 למטא מיד, ומעבדים את התשובה+המדיה ברקע (after). כך מטא לא
  // חושבת שנכשלנו ולא שולחת את ה-webhook שוב ושוב (retry) - מה שגרם לתשובות כפולות.
  after(async () => {
    await Promise.all(
      incoming.map(async (msg) => {
        // חיווי "מקליד..." רציף: מטא מציגה typing_on לכ-10 שניות בלבד, אז מרעננים
        // אותו כל 9 שניות עד שהתשובה נשלחת - כדי שהלקוח יראה "מקליד" לכל אורך ההמתנה.
        let typingTimer: ReturnType<typeof setInterval> | undefined;
        const startTyping = () => {
          if (!adapter.sendTyping) return;
          adapter.sendTyping(msg.senderId).catch(() => {});
          typingTimer = setInterval(
            () => adapter.sendTyping!(msg.senderId).catch(() => {}),
            9000
          );
        };
        const stopTyping = () => {
          if (typingTimer) clearInterval(typingTimer);
          typingTimer = undefined;
        };
        try {
          startTyping();

          // הודעה קולית - מתמללים לפני שמעבירים למוח
          let text = msg.text;
          let meta: Record<string, unknown> | undefined;
          if (!text && msg.audio?.url) {
            const transcript = await transcribeFromUrl(msg.audio.url);
            if (transcript) {
              text = transcript;
              meta = { transcribedFromVoice: true };
            } else {
              text = "[הודעה קולית]";
              meta = { transcribedFromVoice: true, voiceTranscriptionFailed: true };
            }
          }
          if (!text) {
            stopTyping();
            return; // הודעה שאינה טקסט/אודיו - מתעלמים
          }

          const result = await handleIncomingMessage({
            channel,
            channelUserId: msg.senderId,
            text,
            messageId: msg.messageId,
            meta,
            resolveName: adapter.getProfileName
              ? () => adapter.getProfileName!(msg.senderId)
              : undefined,
          });
          stopTyping(); // התשובה מוכנה - מפסיקים להקליד (שליחת ההודעה גם מנקה את החיווי)
          if (result.reply) {
            await adapter.sendText(msg.senderId, result.reply);
          }
          if (result.media && adapter.sendMedia) {
            for (const m of result.media) {
              await adapter.sendMedia(msg.senderId, m.url, m.type).catch((e) =>
                console.error(`[${channel}] media send failed:`, e)
              );
            }
          }
          // עדכון זיכרון הלקוח ברקע (אחרי שהתשובה כבר נשלחה)
          await maybeUpdateCustomerMemory(result.conversationId);
        } catch (err) {
          console.error(`[${channel} webhook] failed:`, err);
        } finally {
          stopTyping();
        }
      })
    );
  });

  return NextResponse.json({ ok: true });
}
