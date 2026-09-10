import { NextRequest, NextResponse } from "next/server";
import { isMasterAuthorized } from "@/lib/admin-auth";
import { runTabitChat, type TabitChatMessage } from "@/lib/tabit-lab";
import { appendLabExchange, getLabSession, type LabToolEntry } from "@/lib/tabit-lab-store";

/**
 * צ'אט מעבדת טאביט - למנהל הראשי בלבד. מבודד לחלוטין מהצ'אטבוט הציבורי.
 *
 * מ-10.9 השיחות נשמרות בצד השרת (tabit-lab-store): הלקוח שולח { sessionId?, message },
 * השרת טוען את ההיסטוריה, מריץ, שומר את החילופין ומחזיר { reply, toolLog, sessionId }.
 * כך המעבדה לא מתאפסת, והמנהל רואה את כל השיחות בהיסטוריה (כולל של בוט הקבוצה).
 */

export const runtime = "nodejs";
export const maxDuration = 200;

/** כמה הודעות אחרונות נשלחות למודל (ההיסטוריה המלאה נשמרת, למודל מספיק ההקשר האחרון) */
const HISTORY_FOR_MODEL = 30;

export async function POST(req: NextRequest) {
  if (!isMasterAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "missing ANTHROPIC_API_KEY" }, { status: 503 });

  let body: { sessionId?: string; message?: string; messages?: { role: "user" | "assistant"; content: string }[] } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // מסלול ישן (טאב פתוח מלפני העדכון): messages מלאים, בלי שמירת סשן
  if (!body.message && Array.isArray(body.messages) && body.messages.length) {
    try {
      const { reply, toolLog } = await runTabitChat(body.messages);
      return NextResponse.json({ reply, toolLog });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
    }
  }

  const message = (body.message || "").trim();
  if (!message) return NextResponse.json({ error: "no message" }, { status: 400 });

  try {
    const session = body.sessionId ? await getLabSession(body.sessionId) : null;
    const history: TabitChatMessage[] = [
      ...(session?.messages.slice(-HISTORY_FOR_MODEL).map((m) => ({ role: m.role, content: m.content })) ?? []),
      { role: "user" as const, content: message },
    ];
    // ה-API דורש שההודעה הראשונה תהיה של user - חיתוך היסטוריה עלול להתחיל באמצע זוג
    while (history.length && history[0].role !== "user") history.shift();

    const { reply, toolLog } = await runTabitChat(history);
    const { sessionId } = await appendLabExchange({
      sessionId: body.sessionId,
      source: "panel",
      userContent: message,
      assistantContent: reply,
      toolLog: toolLog as LabToolEntry[],
    });
    return NextResponse.json({ reply, toolLog, sessionId });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
