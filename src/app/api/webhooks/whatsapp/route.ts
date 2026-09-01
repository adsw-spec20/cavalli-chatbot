/**
 * Webhook של WhatsApp.
 *
 *  GET  — אימות ה-webhook מול מטא (verify token). מטא קורא לזה פעם אחת בהגדרה.
 *  POST — קבלת הודעות נכנסות מלקוחות, שליחה למוח, ותשובה חזרה.
 *
 * משתני סביבה:
 *  - WHATSAPP_VERIFY_TOKEN  מחרוזת שאתה בוחר, ומזין גם בהגדרת ה-webhook במטא.
 */

import { NextRequest, NextResponse, after } from "next/server";
import {
  parseIncoming,
  whatsappAdapter,
  transcribeWhatsAppAudio,
} from "@/lib/channels/whatsapp";
import { handleIncomingMessage } from "@/lib/conversation-service";
import { maybeUpdateCustomerMemory } from "@/lib/customer-memory";
import { verifyMetaSignature } from "@/lib/meta-signature";
import { getRepo } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 90;

/** אימות ה-webhook — מטא שולח GET עם hub.challenge שצריך להחזיר */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

/** קבלת הודעות נכנסות */
export async function POST(req: NextRequest) {
  // אימות חתימת Meta (אותו APP_SECRET כמו מסנג'ר/אינסטגרם) - בלי זה כל אחד
  // שמכיר את ה-URL יכול לזייף הודעות נכנסות.
  const raw = await req.text();
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "bad signature" }, { status: 403 });
  }

  // מחזירים 200 מהר כדי שמטא לא ינסה לשלוח שוב; מעבדים אחרי הקריאה.
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true });
  }

  const incoming = parseIncoming(payload);

  // מטא שולחת את מזהה ה-WABA בכל webhook (entry[].id). הטוקן שלנו לא מורשה
  // לחפש אותו דרך Graph, והוא נדרש לניהול תבניות - אז קולטים אותו מכאן פעם אחת.
  const wabaId = (payload as { entry?: { id?: string }[] })?.entry?.[0]?.id;

  // מחזירים 200 מיד ומעבדים ברקע (after) - כדי שמטא לא תשלח את ה-webhook שוב (retry).
  after(async () => {
    if (wabaId && /^\d+$/.test(wabaId)) {
      try {
        const repo = getRepo();
        if ((await repo.getSetting("waba_id")) !== wabaId) {
          await repo.setSetting("waba_id", wabaId);
        }
      } catch {
        /* מזהה נוח לניהול תבניות, לא קריטי לזרימת ההודעה */
      }
    }
    await Promise.all(
      incoming.map(async (msg) => {
        try {
          // הודעה קולית - מתמללים לפני שמעבירים למוח
          let text = msg.text;
          let meta: Record<string, unknown> | undefined;
          if (!text && msg.audio?.mediaId) {
            const transcript = await transcribeWhatsAppAudio(msg.audio.mediaId);
            if (transcript) {
              text = transcript;
              meta = { transcribedFromVoice: true };
            } else {
              text = "[הודעה קולית]";
              meta = { transcribedFromVoice: true, voiceTranscriptionFailed: true };
            }
          }
          if (!text) return; // הודעה שאינה טקסט/אודיו - מתעלמים

          const result = await handleIncomingMessage({
            channel: "whatsapp",
            channelUserId: msg.senderId,
            text,
            messageId: msg.messageId,
            customerName: msg.senderName,
            meta,
          });
          if (result.reply) {
            await whatsappAdapter.sendText(msg.senderId, result.reply);
          }
          if (result.media && whatsappAdapter.sendMedia) {
            for (const m of result.media) {
              await whatsappAdapter.sendMedia(msg.senderId, m.url, m.type).catch(async (e) => {
                console.error("[whatsapp] media send failed:", e);
                // רשת ביטחון: וואטסאפ דוחה קבצים מסוימים (פורמט/גודל) - במקום שהלקוח
                // יישאר בלי כלום אחרי "מצרף סרטון", שולחים לו את הקישור כטקסט.
                await whatsappAdapter
                  .sendText(msg.senderId, `${m.type === "video" ? "🎥" : "📷"} ${m.url}`)
                  .catch(() => {});
              });
            }
          }
          // עדכון זיכרון הלקוח ברקע (אחרי שהתשובה כבר נשלחה)
          await maybeUpdateCustomerMemory(result.conversationId);
        } catch (err) {
          console.error("[whatsapp webhook] failed to handle message:", err);
        }
      })
    );
  });

  return NextResponse.json({ ok: true });
}
