import { NextRequest, NextResponse } from "next/server";
import {
  agentReply,
  agentReplyMedia,
  closeConversation,
  deleteConversation,
  releaseConversation,
  takeoverConversation,
  setConversationBotPaused,
} from "@/lib/admin-service";
import { isAdminAuthorized, isMasterAuthorized } from "@/lib/admin-auth";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAdminAuthorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json();
  const action: string = body.action;

  try {
    switch (action) {
      case "takeover":
        return NextResponse.json(await takeoverConversation(id, body.agentName));
      case "release":
        return NextResponse.json(await releaseConversation(id, body.agentName));
      case "close":
        return NextResponse.json(await closeConversation(id, body.agentName));
      case "pauseBot":
        return NextResponse.json(await setConversationBotPaused(id, true));
      case "resumeBot":
        return NextResponse.json(await setConversationBotPaused(id, false));
      case "delete":
        // מחיקה לצמיתות - מנהל ראשי בלבד
        if (!isMasterAuthorized(req)) {
          return NextResponse.json({ error: "master only" }, { status: 403 });
        }
        return NextResponse.json(await deleteConversation(id));
      case "reply":
        if (!body.text) {
          return NextResponse.json({ error: "text required" }, { status: 400 });
        }
        return NextResponse.json(await agentReply(id, body.text, body.agentName));
      case "replyMedia": {
        // תמונה/סרטון שנציג צילם או בחר מהגלריה (כבר הועלו ל-Blob מהדפדפן)
        if (typeof body.url !== "string" || !/^https:\/\//.test(body.url)) {
          return NextResponse.json({ error: "https url required" }, { status: 400 });
        }
        const mediaType = body.mediaType === "video" ? "video" : "image";
        return NextResponse.json(await agentReplyMedia(id, body.url, mediaType, body.agentName));
      }
      default:
        return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
