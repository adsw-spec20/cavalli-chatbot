/**
 * Endpoint שה-Playground פונה אליו. עכשיו מבוסס שיחות מתמשכות (persistence):
 * שולחים הודעה אחת + מזהה שיחה, והשרת שומר את ההיסטוריה.
 * זה בדיוק אותו זרם שישרת את וואטסאפ.
 */

import { NextRequest, NextResponse, after } from "next/server";
import { handleIncomingMessage } from "@/lib/conversation-service";
import { maybeUpdateCustomerMemory } from "@/lib/customer-memory";

export const runtime = "nodejs";
export const maxDuration = 30;

// הגנת עלות בסיסית ל-endpoint הציבורי: מגבלת קצב לפי IP (best-effort,
// פר-instance) בנוסף למגבלה הפר-שיחתית שבתוך המוח. עוצרת הרצת בוטים שמסובבים
// conversationId חדש בכל בקשה כדי לעקוף את המגבלה הפנימית.
const IP_WINDOW_MS = 60_000;
const IP_MAX_PER_WINDOW = 20;
const ipHits = new Map<string, number[]>();
function ipAllowed(ip: string): boolean {
  const now = Date.now();
  const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < IP_WINDOW_MS);
  hits.push(now);
  ipHits.set(ip, hits);
  if (ipHits.size > 5000) ipHits.clear(); // הגנת זיכרון
  return hits.length <= IP_MAX_PER_WINDOW;
}

const MAX_MESSAGE_LEN = 2000;

export async function POST(req: NextRequest) {
  try {
    const ip =
      req.headers.get("x-real-ip") ??
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown";
    if (!ipAllowed(ip)) {
      return NextResponse.json(
        { error: "יותר מדי בקשות, נסה שוב בעוד רגע" },
        { status: 429 }
      );
    }

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
    if (message.length > MAX_MESSAGE_LEN) {
      return NextResponse.json(
        { error: "message too long" },
        { status: 413 }
      );
    }

    const result = await handleIncomingMessage({
      channel: "playground",
      channelUserId: clientId,
      text: message,
      conversationId,
    });

    // עדכון זיכרון הלקוח ברקע (אחרי שהתשובה הוחזרה) - כדי שגם ה-Playground ידגים
    // זיכרון לקוח חוזר, בלי להאט את התגובה.
    after(() => maybeUpdateCustomerMemory(result.conversationId));

    return NextResponse.json({
      conversationId: result.conversationId,
      reply: result.reply,
      status: result.status,
      media: result.media,
    });
  } catch (err) {
    // הפרטים נשארים בלוג בלבד - לא מחזירים שגיאות פנימיות ללקוח
    console.error("[/api/chat] error:", err);
    return NextResponse.json({ error: "temporary error" }, { status: 500 });
  }
}
