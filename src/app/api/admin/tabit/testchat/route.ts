import { NextRequest, NextResponse } from "next/server";
import { isMasterAuthorized } from "@/lib/admin-auth";
import { runTabitChat } from "@/lib/tabit-lab";

/**
 * צ'אט מעבדת טאביט - למנהל הראשי בלבד. מבודד לחלוטין מהצ'אטבוט הציבורי.
 * לולאת הכלים עצמה חיה ב-lib המשותף (tabit-lab) כדי שגם בוט הקבוצה בוואטסאפ
 * ישתמש בה. שלב 1: כלי כתיבה מושבתים (ראה tabit-lab + agent.js).
 */

export const runtime = "nodejs";
export const maxDuration = 200;

export async function POST(req: NextRequest) {
  if (!isMasterAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "missing ANTHROPIC_API_KEY" }, { status: 503 });

  let body: { messages?: { role: "user" | "assistant"; content: string }[] } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const history = Array.isArray(body.messages) ? body.messages : [];
  if (!history.length) return NextResponse.json({ error: "no messages" }, { status: 400 });

  try {
    const { reply, toolLog } = await runTabitChat(history);
    return NextResponse.json({ reply, toolLog });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
