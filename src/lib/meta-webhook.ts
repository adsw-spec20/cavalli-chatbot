/**
 * לוגיקת webhook משותפת ל-Messenger ולאינסטגרם (אותו פרוטוקול של Meta).
 *  GET  - אימות מול Meta (verify token).
 *  POST - קבלת הודעות: אימות חתימה, הצגת "מקליד...", מענה דרך המוח.
 */

import { NextRequest, NextResponse } from "next/server";
import { handleIncomingMessage } from "./conversation-service";
import { parseMetaMessaging } from "./channels/meta-messaging";
import { verifyMetaSignature } from "./meta-signature";
import type { ChannelAdapter } from "./channels/types";

export function handleVerify(req: NextRequest, verifyToken: string): NextResponse {
  const p = req.nextUrl.searchParams;
  if (p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === verifyToken) {
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
  await Promise.all(
    incoming.map(async (msg) => {
      try {
        // "מקליד..." מיד עם קבלת ההודעה (לפני ההמתנה/החשיבה)
        adapter.sendTyping?.(msg.senderId).catch(() => {});
        const result = await handleIncomingMessage({
          channel,
          channelUserId: msg.senderId,
          text: msg.text,
        });
        if (result.reply) {
          await adapter.sendText(msg.senderId, result.reply);
        }
      } catch (err) {
        console.error(`[${channel} webhook] failed:`, err);
      }
    })
  );

  return NextResponse.json({ ok: true });
}
