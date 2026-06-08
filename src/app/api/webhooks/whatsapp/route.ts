/**
 * Webhook של WhatsApp.
 *
 *  GET  — אימות ה-webhook מול מטא (verify token). מטא קורא לזה פעם אחת בהגדרה.
 *  POST — קבלת הודעות נכנסות מלקוחות, שליחה למוח, ותשובה חזרה.
 *
 * משתני סביבה:
 *  - WHATSAPP_VERIFY_TOKEN  מחרוזת שאתה בוחר, ומזין גם בהגדרת ה-webhook במטא.
 */

import { NextRequest, NextResponse } from "next/server";
import { parseIncoming, whatsappAdapter } from "@/lib/channels/whatsapp";
import { handleIncomingMessage } from "@/lib/conversation-service";

export const runtime = "nodejs";
export const maxDuration = 30;

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
  // מחזירים 200 מהר כדי שמטא לא ינסה לשלוח שוב; מעבדים אחרי הקריאה.
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  const incoming = parseIncoming(payload);

  // מעבדים כל הודעה (בדרך כלל אחת)
  await Promise.all(
    incoming.map(async (msg) => {
      try {
        const result = await handleIncomingMessage({
          channel: "whatsapp",
          channelUserId: msg.senderId,
          text: msg.text,
        });
        // אם נציג אנושי מטפל בשיחה, הבוט לא שולח כלום
        if (result.reply) {
          await whatsappAdapter.sendText(msg.senderId, result.reply);
        }
      } catch (err) {
        console.error("[whatsapp webhook] failed to handle message:", err);
      }
    })
  );

  return NextResponse.json({ ok: true });
}
