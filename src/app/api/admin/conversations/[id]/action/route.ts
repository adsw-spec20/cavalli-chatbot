import { NextRequest, NextResponse } from "next/server";
import {
  agentReply,
  closeConversation,
  releaseConversation,
  takeoverConversation,
  setConversationBotPaused,
} from "@/lib/admin-service";
import { isAdminAuthorized } from "@/lib/admin-auth";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdminAuthorized(req)) {
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
      case "reply":
        if (!body.text) {
          return NextResponse.json({ error: "text required" }, { status: 400 });
        }
        return NextResponse.json(await agentReply(id, body.text, body.agentName));
      default:
        return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
