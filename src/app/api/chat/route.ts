/**
 * Endpoint שה-Playground פונה אליו. עכשיו מבוסס שיחות מתמשכות (persistence):
 * שולחים הודעה אחת + מזהה שיחה, והשרת שומר את ההיסטוריה.
 * זה בדיוק אותו זרם שישרת את וואטסאפ.
 */

import { NextRequest, NextResponse } from "next/server";
import { handleIncomingMessage } from "@/lib/conversation-service";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const message: string = body.message;
    const conversationId: string | undefined = body.conversationId;
    const clientId: string = body.clientId || "anon";

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "message (string) is required" },
        { status: 400 }
      );
    }

    const result = await handleIncomingMessage({
      channel: "playground",
      channelUserId: clientId,
      text: message,
      conversationId,
    });

    return NextResponse.json({
      conversationId: result.conversationId,
      reply: result.reply,
      status: result.status,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[/api/chat] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
