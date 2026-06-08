/**
 * שירות הניהול: אינבוקס שיחות + אנליטיקה.
 *
 * משמש את ה-API של פאנל הניהול: רשימת שיחות, צפייה בשיחה, השתלטות נציג אנושי,
 * שחרור חזרה לבוט, שליחת תשובת נציג, וחישוב סטטיסטיקות.
 */

import { getRepo } from "./db";
import { whatsappAdapter } from "./channels/whatsapp";
import type { Conversation, Customer, LearnedQA, StoredMessage } from "./db";

const STOPWORDS = new Set([
  "של", "עם", "מה", "יש", "לי", "אני", "הוא", "היא", "את", "על", "או", "גם",
  "כמה", "עולה", "אם", "כן", "לא", "זה", "אבל", "כל", "אפשר", "רוצה", "צריך",
  "היי", "שלום", "תודה", "אתם", "אתה", "הכי", "וגם", "עוד", "כדי", "פה",
]);

export interface ConversationListItem {
  id: string;
  channel: string;
  status: string;
  escalated?: boolean;
  escalationReason?: string;
  customerName?: string;
  customerId: string;
  updatedAt: number;
  lastMessage?: string;
  messageCount: number;
  /** האם ההודעה האחרונה מהלקוח (כלומר ממתינה למענה) */
  awaiting: boolean;
}

export async function listConversations(): Promise<ConversationListItem[]> {
  const repo = getRepo();
  const convs = await repo.listConversations();
  const all = await repo.getAllMessages();
  return convs.map((c) => {
    const msgs = all.filter((m) => m.conversationId === c.id);
    const lastNonSystem = [...msgs]
      .reverse()
      .find((m) => m.role !== "system");
    return {
      id: c.id,
      channel: c.channel,
      status: c.status,
      escalated: c.escalated,
      escalationReason: c.escalationReason,
      customerName: undefined,
      customerId: c.customerId,
      updatedAt: c.updatedAt,
      lastMessage: lastNonSystem?.content.slice(0, 80),
      messageCount: msgs.length,
      awaiting: lastNonSystem?.role === "user",
    };
  });
}

/** כפתור כיבוי: האם הבוט פעיל */
export async function getBotEnabled(): Promise<boolean> {
  return (await getRepo().getSetting("bot_enabled")) !== "false";
}
export async function setBotEnabled(enabled: boolean): Promise<void> {
  await getRepo().setSetting("bot_enabled", enabled ? "true" : "false");
}

export interface ConversationDetail {
  conversation: Conversation;
  customer: Customer | null;
  messages: StoredMessage[];
}

export async function getConversationDetail(
  id: string
): Promise<ConversationDetail | null> {
  const repo = getRepo();
  const conversation = await repo.getConversation(id);
  if (!conversation) return null;
  const customer = await repo.getCustomer(conversation.customerId);
  const messages = await repo.getMessages(id);
  return { conversation, customer, messages };
}

export async function takeoverConversation(id: string) {
  return getRepo().updateConversation(id, { status: "human" });
}

export async function releaseConversation(id: string) {
  return getRepo().updateConversation(id, {
    status: "bot",
    escalated: false,
    escalationReason: undefined,
  });
}

export async function closeConversation(id: string) {
  return getRepo().updateConversation(id, { status: "closed" });
}

/** נציג אנושי שולח תשובה. בערוצים אמיתיים (וואטסאפ) גם נשלח ללקוח. */
export async function agentReply(id: string, text: string) {
  const repo = getRepo();
  const conversation = await repo.getConversation(id);
  if (!conversation) throw new Error("conversation not found");

  const message = await repo.addMessage({
    conversationId: id,
    role: "agent",
    content: text,
    ts: Date.now(),
  });

  // משלוח בערוץ האמיתי
  const customer = await repo.getCustomer(conversation.customerId);
  if (conversation.channel === "whatsapp" && customer) {
    await whatsappAdapter.sendText(customer.channelUserId, text);
  }
  return message;
}

/** ניהול הידע הנלמד: שאלות פתוחות + תשובות הצוות */
export async function listKnowledge(
  status?: "open" | "answered"
): Promise<LearnedQA[]> {
  return getRepo().listLearnedQA(status);
}
export async function answerKnowledge(id: string, answer: string) {
  return getRepo().answerLearnedQA(id, answer);
}
export async function deleteKnowledge(id: string) {
  return getRepo().deleteLearnedQA(id);
}

export interface Stats {
  totalConversations: number;
  byStatus: { bot: number; human: number; closed: number };
  escalated: number;
  deflectionRate: number; // אחוז השיחות שהבוט סגר בלי הסלמה
  totalUserMessages: number;
  last7Days: { date: string; count: number }[];
  topWords: { word: string; count: number }[];
  needsAttention: number; // שיחות שמחכות לטיפול אנושי
  openQuestions: number; // שאלות שממתינות לתשובת הצוות
}

export async function computeStats(): Promise<Stats> {
  const repo = getRepo();
  const convs = await repo.listConversations();
  const msgs = await repo.getAllMessages();
  const userMsgs = msgs.filter((m) => m.role === "user");

  const openQuestions = (await repo.listLearnedQA("open")).length;
  const total = convs.length;
  const escalated = convs.filter((c) => c.escalated).length;
  const byStatus = {
    bot: convs.filter((c) => c.status === "bot").length,
    human: convs.filter((c) => c.status === "human").length,
    closed: convs.filter((c) => c.status === "closed").length,
  };

  // נפח 7 ימים אחרונים
  const last7Days: { date: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const count = convs.filter(
      (c) => new Date(c.createdAt).toISOString().slice(0, 10) === key
    ).length;
    last7Days.push({ date: key, count });
  }

  // מילים נפוצות בשאלות הלקוחות (אינדיקציה למה שואלים)
  const wordCounts = new Map<string, number>();
  for (const m of userMsgs) {
    const words = m.content
      .toLowerCase()
      .replace(/[׳ʼ'’"״`]/g, "")
      .replace(/[^֐-׿a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
    for (const w of words) wordCounts.set(w, (wordCounts.get(w) ?? 0) + 1);
  }
  const topWords = [...wordCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word, count]) => ({ word, count }));

  return {
    totalConversations: total,
    byStatus,
    escalated,
    deflectionRate: total ? Math.round(((total - escalated) / total) * 100) : 0,
    totalUserMessages: userMsgs.length,
    last7Days,
    topWords,
    needsAttention: byStatus.human,
    openQuestions,
  };
}
