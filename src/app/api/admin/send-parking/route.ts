import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthorized } from "@/lib/admin-auth";
import { getRepo } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * שליחה יזומה של הוראות הגעה וחניה ללקוח בוואטסאפ (תבנית parking_directions).
 * למקרה הנפוץ: לקוח מתקשר למסעדה ומבקש מהמארחת "שלחי לי איך מגיעים לחניה".
 * נשלח כתבנית מאושרת (מותר גם ללקוח שמעולם לא כתב לנו), והשיחה מתועדת בפאנל -
 * אם הלקוח יענה, ההודעה תיכנס לאותה שיחה והבוט ימשיך כרגיל.
 */
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) {
    return NextResponse.json({ error: "וואטסאפ לא מוגדר בשרת" }, { status: 500 });
  }
  const body = (await req.json().catch(() => ({}))) as { phone?: string; agentName?: string };
  const digits = (body.phone ?? "").replace(/\D/g, "");
  if (digits.length < 9) {
    return NextResponse.json({ error: "מספר טלפון לא תקין" }, { status: 400 });
  }
  const to = digits.startsWith("0") ? "972" + digits.slice(1) : digits;

  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template: { name: "parking_directions_v2", language: { code: "he" } },
    }),
  });
  if (!res.ok) {
    const errText = (await res.text()).slice(0, 300);
    console.error("[send-parking] נכשל:", res.status, errText);
    const friendly = errText.includes("payment")
      ? "מטא דורשת אמצעי תשלום מחובר לחשבון הוואטסאפ (הגדרה חד-פעמית)"
      : errText.includes("does not exist") || errText.includes("template")
        ? "תבנית ההודעה עדיין לא אושרה על ידי מטא - נסו שוב מאוחר יותר"
        : "השליחה נכשלה - ודאו שהמספר תקין ופעיל בוואטסאפ";
    return NextResponse.json({ error: friendly, detail: errText }, { status: 502 });
  }

  // תיעוד בפאנל: שיחה ללקוח הזה (קיימת או חדשה) + רישום הפעולה
  try {
    const repo = getRepo();
    const customerId = `whatsapp:${to}`;
    await repo.upsertCustomer({ id: customerId, channel: "whatsapp", channelUserId: to });
    // חלון אחד לכל לקוח: שיחה פתוחה אם יש, אחרת פותחים מחדש את האחרונה שנסגרה
    const mine = (await repo.listConversations()).filter((c) => c.customerId === customerId);
    const existing = mine.find((c) => c.status !== "closed") ?? mine[0];
    let conversation =
      existing ??
      (await repo.createConversation({
        id: crypto.randomUUID(),
        channel: "whatsapp",
        customerId,
        status: "bot",
      }));
    if (conversation.status === "closed") {
      conversation =
        (await repo.updateConversation(conversation.id, { status: "bot" })) ?? conversation;
      await repo.addMessage({
        conversationId: conversation.id,
        role: "system",
        content: "🔄 השיחה נפתחה מחדש (שליחה יזומה מהפאנל)",
        ts: Date.now(),
        meta: { activity: true, reopened: true },
      });
    }
    await repo.addMessage({
      conversationId: conversation.id,
      role: "agent",
      content: "📍 נשלחו ללקוח הוראות הגעה וחניה בוואטסאפ (שליחה יזומה)",
      ts: Date.now(),
      meta: { proactive: true, agentName: body.agentName || "הצוות" },
    });
  } catch (err) {
    console.error("[send-parking] תיעוד בפאנל נכשל (ההודעה כן נשלחה):", err);
  }
  return NextResponse.json({ ok: true });
}
