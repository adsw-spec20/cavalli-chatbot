/**
 * שליחה יזומה של תבנית מאושרת ללקוח בוואטסאפ.
 *
 * המקרה הנפוץ: לקוח מתקשר למסעדה והמארחת רוצה לשלוח לו משהו בוואטסאפ -
 * הוראות חניה, או תזכורת להשלים את תשלום הפיקדון. מחוץ לחלון 24 השעות
 * מטא מרשה רק תבניות מאושרות, ולכן זה לא נשלח כטקסט חופשי.
 *
 * כל שליחה מתועדת בפאנל: אם הלקוח יענה, ההודעה תיכנס לאותה שיחה
 * והבוט ימשיך משם כרגיל.
 */

import { getRepo } from "./db";

export interface ProactiveTemplate {
  /** שם התבנית כפי שאושרה במטא */
  template: string;
  /** מה נרשם בשיחה בפאנל אחרי שליחה מוצלחת */
  logText: string;
}

export const PROACTIVE_TEMPLATES = {
  parking: {
    template: "parking_directions_v2",
    logText: "📍 נשלחו ללקוח הוראות הגעה וחניה בוואטסאפ (שליחה יזומה)",
  },
  payment: {
    template: "payment_reminder",
    logText: "💳 נשלחה ללקוח תזכורת להשלמת תשלום הפיקדון בוואטסאפ (שליחה יזומה)",
  },
} satisfies Record<string, ProactiveTemplate>;

export type ProactiveKind = keyof typeof PROACTIVE_TEMPLATES;

export interface ProactiveResult {
  ok: boolean;
  status: number;
  /** הודעה ידידותית להצגה למארחת */
  error?: string;
  detail?: string;
}

/** "050-1234567" / "0501234567" -> "9725..." (הפורמט שמטא מצפה לו) */
export function toWhatsAppNumber(phone: string): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 9) return null;
  return digits.startsWith("0") ? "972" + digits.slice(1) : digits;
}

/**
 * שולח את התבנית ומתעד בפאנל. לא זורק - מחזיר תוצאה, כדי שהמסך
 * יוכל להציג למארחת סיבה מובנת ולא סתם "נכשל".
 */
export async function sendProactiveTemplate(args: {
  kind: ProactiveKind;
  phone: string;
  agentName?: string;
}): Promise<ProactiveResult> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) {
    return { ok: false, status: 500, error: "וואטסאפ לא מוגדר בשרת" };
  }
  const to = toWhatsAppNumber(args.phone);
  if (!to) return { ok: false, status: 400, error: "מספר טלפון לא תקין" };

  const { template, logText } = PROACTIVE_TEMPLATES[args.kind];
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template: { name: template, language: { code: "he" } },
    }),
  });

  if (!res.ok) {
    const errText = (await res.text()).slice(0, 300);
    console.error(`[proactive:${args.kind}] נכשל:`, res.status, errText);
    const error = /payment|funding/i.test(errText)
      ? "מטא דורשת אמצעי תשלום מחובר לחשבון הוואטסאפ (הגדרה חד-פעמית)"
      : /does not exist|template/i.test(errText)
        ? "תבנית ההודעה עדיין לא אושרה על ידי מטא - נסו שוב מאוחר יותר"
        : "השליחה נכשלה - ודאו שהמספר תקין ופעיל בוואטסאפ";
    return { ok: false, status: 502, error, detail: errText };
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
      content: logText,
      ts: Date.now(),
      meta: { proactive: true, agentName: args.agentName || "הצוות" },
    });
  } catch (err) {
    console.error(`[proactive:${args.kind}] תיעוד בפאנל נכשל (ההודעה כן נשלחה):`, err);
  }
  return { ok: true, status: 200 };
}
