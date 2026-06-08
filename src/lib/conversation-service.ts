/**
 * שכבת השירות שמחברת הודעות נכנסות לשיחות מתמשכות.
 *
 * זה המקום המרכזי שבו: מזהים/יוצרים לקוח ושיחה, שומרים הודעות, מפעילים את
 * המוח, ושומרים את התשובה. משמש גם את ה-Playground וגם את כל הערוצים.
 * אם נציג אנושי השתלט על השיחה (status=human), הבוט שותק.
 */

import { randomUUID } from "crypto";
import { getRepo } from "./db";
import { generateReply } from "./claude";
import { businessConfig } from "./business-config";
import { isOpenNow } from "./business-hours";
import type { Channel, ConversationMessage } from "./channels/types";

// זיהוי "רק ברכה" (היי / שלום / בוקר טוב) כדי לפתוח בהודעת גילוי אחת ונקייה,
// בלי קריאת מודל מיותרת ובלי ברכה כפולה.
const GREETING_WORDS = new Set([
  "היי", "הי", "הייי", "שלום", "אהלן", "יו", "הלו", "הולו", "heyy", "hi",
  "hello", "hey", "בוקר", "טוב", "ערב", "צהריים", "טובים", "מה", "נשמע",
  "קורה", "המצב", "שלומך",
]);

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[׳ʼ'’"״`]/g, "")
    .replace(/[^֐-׿a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isGreetingOnly(text: string): boolean {
  const words = normalizeText(text).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  if (words.length > 3) return false;
  return words.every((w) => GREETING_WORDS.has(w));
}

/** מנסח הודעת העברה לאדם, לפי שעות הפעילות */
function buildHandoffMessage(): string {
  const phone = businessConfig.contact.phone;
  const phoneLine = phone ? ` אפשר גם להתקשר ל-${phone}.` : "";
  if (isOpenNow(businessConfig)) {
    return `הבנתי 🙋 אני מעביר אותך לנציג אנושי מהצוות, והוא יחזור אליך כאן בהקדם.${phoneLine}`;
  }
  return `הבנתי 🙋 אני מעביר את פנייתך לצוות. אנחנו כרגע סגורים, אז הם יחזרו אליך בשעות הפעילות.${phoneLine}`;
}

const HISTORY_LIMIT = 20;

export interface HandleInput {
  channel: Channel;
  /** מזהה ייחודי של המשתמש בתוך הערוץ (טלפון / PSID / clientId בדפדפן) */
  channelUserId: string;
  text: string;
  /** מזהה שיחה אם ידוע (כדי להמשיך שיחה קיימת) */
  conversationId?: string;
  customerName?: string;
  /** מטא-דאטה להודעה, למשל { transcribedFromVoice: true } */
  meta?: Record<string, unknown>;
}

export interface HandleResult {
  conversationId: string;
  /** התשובה של הבוט, או null אם נציג אנושי מטפל בשיחה */
  reply: string | null;
  status: "bot" | "human" | "closed";
}

export async function handleIncomingMessage(
  input: HandleInput
): Promise<HandleResult> {
  const repo = getRepo();
  const customerId = `${input.channel}:${input.channelUserId}`;

  await repo.upsertCustomer({
    id: customerId,
    channel: input.channel,
    channelUserId: input.channelUserId,
    name: input.customerName,
  });

  // מציאת שיחה פעילה או יצירת חדשה
  let conversation = input.conversationId
    ? await repo.getConversation(input.conversationId)
    : null;
  if (!conversation || conversation.status === "closed") {
    conversation = await repo.createConversation({
      id: randomUUID(),
      channel: input.channel,
      customerId,
      status: "bot",
    });
  }

  // שמירת הודעת המשתמש
  await repo.addMessage({
    conversationId: conversation.id,
    role: "user",
    content: input.text,
    ts: Date.now(),
    meta: input.meta,
  });

  // אם נציג אנושי כבר מטפל בשיחה, הבוט לא עונה
  if (conversation.status === "human") {
    return { conversationId: conversation.id, reply: null, status: "human" };
  }

  const isFirstTurn = !conversation.disclosedAi;

  // פתיחה נקייה: אם זו ההודעה הראשונה והלקוח רק בירך, החזר את משפט הגילוי בלבד
  // (הוא כבר מברך ושואל "איך אפשר לעזור"), בלי קריאת מודל ובלי ברכה כפולה.
  if (isFirstTurn && businessConfig.aiDisclosure && isGreetingOnly(input.text)) {
    await repo.updateConversation(conversation.id, { disclosedAi: true });
    await repo.addMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: businessConfig.aiDisclosure,
      ts: Date.now(),
    });
    return {
      conversationId: conversation.id,
      reply: businessConfig.aiDisclosure,
      status: "bot",
    };
  }

  // בניית היסטוריה למודל (רק הודעות לקוח/בוט, חלון אחרון)
  const stored = await repo.getMessages(conversation.id);
  const history: ConversationMessage[] = stored
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-HISTORY_LIMIT)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  const result = await generateReply(history, { firstTurn: isFirstTurn });

  // ----- המודל החליט להעביר לנציג אנושי -----
  if (result.escalate) {
    await repo.updateConversation(conversation.id, {
      status: "human",
      escalated: true,
      escalationReason: result.escalate.reason,
      escalationSummary: result.escalate.summary,
    });
    await repo.addMessage({
      conversationId: conversation.id,
      role: "system",
      content: `הוסלם לנציג: ${result.escalate.reason}\nסיכום: ${result.escalate.summary}`,
      ts: Date.now(),
      meta: { escalation: true, summary: result.escalate.summary },
    });

    let handoff = buildHandoffMessage();
    if (isFirstTurn && businessConfig.aiDisclosure) {
      handoff = `${businessConfig.aiDisclosure}\n\n${handoff}`;
      await repo.updateConversation(conversation.id, { disclosedAi: true });
    }
    await repo.addMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: handoff,
      ts: Date.now(),
      meta: { escalation: true },
    });
    // התראה לצוות (כרגע ללוג; בהמשך אימייל/וואטסאפ/דחיפה)
    console.log(
      `[ESCALATION] conv=${conversation.id} customer=${customerId} reason=${result.escalate.reason}`
    );
    return { conversationId: conversation.id, reply: handoff, status: "human" };
  }

  // ----- תשובה רגילה -----
  let reply = (result.text ?? "").trim();
  if (isFirstTurn && businessConfig.aiDisclosure) {
    // משלבים את גילוי ה-AI כפתיח. אם הבוט בחר לא להוסיף כלום (רק ברכה), נשאר הגילוי בלבד.
    reply = reply
      ? `${businessConfig.aiDisclosure}\n\n${reply}`
      : businessConfig.aiDisclosure;
    await repo.updateConversation(conversation.id, { disclosedAi: true });
  } else if (!reply) {
    reply = "מצטער, לא הצלחתי לעבד את הבקשה. אפשר לנסות שוב?";
  }

  await repo.addMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: reply,
    ts: Date.now(),
  });

  return { conversationId: conversation.id, reply, status: "bot" };
}
