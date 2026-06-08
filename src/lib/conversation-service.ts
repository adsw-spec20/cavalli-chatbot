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

// ביטויים שמעידים שהבוט לא ידע לענות (פער ידע) -> נרשום את שאלת הלקוח
const GAP_PATTERNS = [
  "אין לי את",
  "אין לי מידע",
  "אין לי פרט",
  "אין לי כרגע",
  "אין לי גישה",
  "אין לי את הפרט",
  "אין לי את התאריך",
  "אין לי את כל הפרט",
  "לא מופיע אצלי",
  "לא נמצא אצלי",
  "לא מצאתי",
  "כדאי לברר",
  "שווה לברר",
  "לברר עם הצוות",
  "לברר ישירות",
  "לבדוק עם הצוות",
  "לבדוק מול הצוות",
  "הצוות ישמח לספר",
  "הצוות יוכל לעדכן",
];

function detectKnowledgeGap(reply: string): boolean {
  return GAP_PATTERNS.some((p) => reply.includes(p));
}

/** רושם שאלה פתוחה (עם מניעת כפילויות מול שאלות פתוחות ושנענו) */
async function logOpenQuestion(
  question: string,
  conversationId: string
): Promise<void> {
  const q = question.trim();
  if (q.length < 4) return;
  const repo = getRepo();
  const all = await repo.listLearnedQA();
  const key = q.toLowerCase();
  if (all.some((e) => e.question.trim().toLowerCase() === key)) return;
  await repo.addOpenQuestion({ question: q, conversationId });
}

/** מנסח הודעת העברה לאדם, לפי שעות הפעילות. ב-firstTurn שוזר גילוי AI בלי "איך אפשר לעזור". */
function buildHandoffMessage(firstTurn: boolean): string {
  const phone = businessConfig.contact.phone;
  const phoneLine = phone ? ` אפשר גם להתקשר ל-${phone}.` : "";
  const body = isOpenNow(businessConfig)
    ? `מעביר אותך לנציג אנושי מהצוות, והוא יחזור אליך כאן בהקדם.${phoneLine}`
    : `מעביר את פנייתך לצוות. אנחנו כרגע סגורים, אז הם יחזרו אליך בשעות הפעילות.${phoneLine}`;
  if (firstTurn) {
    return `אני העוזר הדיגיטלי של ${businessConfig.name}, ואני ${body}`;
  }
  return `הבנתי 🙋 אני ${body}`;
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

  // כפתור כיבוי גלובלי: אם הבוט כבוי, הוא שותק וההודעה ממתינה לצוות (רשת ביטחון)
  const botEnabled = (await repo.getSetting("bot_enabled")) !== "false";
  if (!botEnabled) {
    return { conversationId: conversation.id, reply: null, status: conversation.status };
  }

  const isFirstTurn = !conversation.disclosedAi;

  // בניית היסטוריה למודל (רק הודעות לקוח/בוט, חלון אחרון)
  const stored = await repo.getMessages(conversation.id);
  const history: ConversationMessage[] = stored
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-HISTORY_LIMIT)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  // ידע נלמד: שאלות שהצוות ענה עליהן מוזרקות לבוט
  const answeredQA = await repo.listLearnedQA("answered");
  const learnedFaqs = answeredQA
    .filter((q) => q.answer)
    .map((q) => ({ question: q.question, answer: q.answer as string }));

  const result = await generateReply(history, {
    firstTurn: isFirstTurn,
    learnedFaqs,
  });

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

    const handoff = buildHandoffMessage(isFirstTurn);
    if (isFirstTurn) {
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
  // בהודעה ראשונה עם שאלה, המודל כבר שזר את גילוי ה-AI בתוך התשובה (ראה claude.ts),
  // אז לא מדביקים משפט קבוע. (פתיחה של "רק ברכה" טופלה למעלה במסלול נפרד.)
  let reply = (result.text ?? "").trim();
  if (!reply) {
    reply = "סליחה, לא הבנתי. אפשר לנסות שוב? 🙂";
  }
  if (isFirstTurn) {
    await repo.updateConversation(conversation.id, { disclosedAi: true });
  }

  // תיעוד פערי ידע: עדיפות לשאלות שהמודל סימן במפורש (report_knowledge_gap),
  // ובגיבוי - זיהוי דטרמיניסטי לפי ניסוח התשובה. כך נתפסת כל שאלה שלא נענתה.
  if (result.gapQuestions?.length) {
    for (const q of result.gapQuestions) {
      await logOpenQuestion(q, conversation.id);
    }
  } else if (detectKnowledgeGap(reply)) {
    await logOpenQuestion(input.text, conversation.id);
  }

  await repo.addMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: reply,
    ts: Date.now(),
  });

  return { conversationId: conversation.id, reply, status: "bot" };
}
