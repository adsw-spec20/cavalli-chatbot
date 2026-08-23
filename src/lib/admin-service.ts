/**
 * שירות הניהול: אינבוקס שיחות + אנליטיקה.
 *
 * משמש את ה-API של פאנל הניהול: רשימת שיחות, צפייה בשיחה, השתלטות נציג אנושי,
 * שחרור חזרה לבוט, שליחת תשובת נציג, וחישוב סטטיסטיקות.
 */

import { getRepo } from "./db";
import { whatsappAdapter } from "./channels/whatsapp";
import { messengerAdapter, instagramAdapter } from "./channels/meta-messaging";
import {
  loadBusinessConfig,
  saveBusinessConfig,
  getDefaultBusinessConfig,
} from "./business-config-store";
import { loadMedia, saveMedia, type MediaItem } from "./media-store";
import { generateReply } from "./claude";
import { recordLlmUsage } from "./usage";
import { topicBreakdown } from "./insights";
import { polishAnswer } from "./knowledge-filter";
import { countPendingReservations } from "./reservations";
import type { BusinessConfig } from "./business-config";
import { AGENT_MSG_PREFIX, type ChannelAdapter, type ConversationMessage } from "./channels/types";
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
  urgent?: boolean;
  botPaused?: boolean;
  customerName?: string;
  customerId: string;
  vip?: boolean;
  tags?: string[];
  updatedAt: number;
  lastMessage?: string;
  /** חותמת זמן של הודעת הלקוח האחרונה (לחישוב זמן המתנה / SLA) */
  lastUserTs?: number;
  messageCount?: number;
  /** האם ההודעה האחרונה מהלקוח (כלומר ממתינה למענה) */
  awaiting: boolean;
  /** תפקיד כותב ההודעה האחרונה (user/assistant/agent) - מאפשר לזהות שיחה אצל
      נציג שאף נציג עוד לא ענה בה, גם כשההודעה האחרונה היא הודעת ההעברה של הבוט */
  lastRole?: string;
}

export async function listConversations(): Promise<ConversationListItem[]> {
  // שאילתת סיכום אחת (בלי למשוך את כל ההודעות) - נשאר מהיר גם עם אלפי הודעות
  const summaries = await getRepo().getConversationSummaries();
  return summaries.map((s) => {
    const c = s.conversation;
    return {
      id: c.id,
      channel: c.channel,
      status: c.status,
      escalated: c.escalated,
      escalationReason: c.escalationReason,
      urgent: (c.meta as { urgent?: boolean } | undefined)?.urgent,
      botPaused: c.botPaused,
      customerName: s.customerName,
      customerId: c.customerId,
      vip: s.customerVip,
      tags: s.customerTags,
      updatedAt: c.updatedAt,
      lastMessage: s.lastMessage,
      lastUserTs: s.lastUserTs,
      messageCount: s.messageCount,
      awaiting: s.lastMessageRole === "user",
      lastRole: s.lastMessageRole,
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

/** הודעה להצגה בפאנל: מועשרת בכתובות המדיה שנשלחה איתה (אם נשלחה) */
export interface PanelMessage extends StoredMessage {
  media?: { url: string; type: "image" | "video"; label?: string }[];
}

export interface ConversationDetail {
  conversation: Conversation;
  customer: Customer | null;
  messages: PanelMessage[];
  /** יש הודעות ישנות יותר שלא נשלחו (הפאנל מציג כפתור "טען את כל ההיסטוריה") */
  hasOlder?: boolean;
}

/** כמה הודעות אחרונות נשלחות לפאנל כברירת מחדל - שיחות ותיקות לא מורידות
    מאות הודעות לטלפון בכל פתיחה ובכל רענון של 4 שניות */
const DETAIL_MESSAGE_LIMIT = 120;

export async function getConversationDetail(
  id: string,
  opts?: { allMessages?: boolean }
): Promise<ConversationDetail | null> {
  const repo = getRepo();
  const conversation = await repo.getConversation(id);
  if (!conversation) return null;
  const limit = opts?.allMessages ? undefined : DETAIL_MESSAGE_LIMIT;
  const [customer, messages] = await Promise.all([
    repo.getCustomer(conversation.customerId),
    repo.getMessages(id, limit ? { limit } : undefined) as Promise<PanelMessage[]>,
  ]);
  const hasOlder = !!limit && messages.length === limit;
  // העשרה להצגה: הודעות שנשלחה איתן מדיה נושאות רק מזהים (meta.sentMedia) -
  // פותרים אותם מול ספריית המדיה כדי שהצוות יראה את התמונה/סרטון כמו הלקוח.
  if (messages.some((m) => Array.isArray(m.meta?.sentMedia))) {
    const lib = new Map((await loadMedia()).map((m) => [m.id, m]));
    for (const msg of messages) {
      const ids = msg.meta?.sentMedia as string[] | undefined;
      if (!ids?.length) continue;
      const items = ids.flatMap((mid) => {
        const item = lib.get(mid);
        // פריט שנמחק בינתיים מהספרייה - אין מה להציג (הטקסט של ההודעה נשאר)
        return item ? [{ url: item.url, type: item.type, label: item.label }] : [];
      });
      if (items.length) msg.media = items;
    }
  }
  return { conversation, customer, messages, hasOlder };
}

/** רישום פעולה ביומן הפעילות של השיחה (מוצג בתוך השיחה). */
async function logActivity(conversationId: string, text: string) {
  await getRepo().addMessage({
    conversationId,
    role: "system",
    content: text,
    ts: Date.now(),
    meta: { activity: true },
  });
}

export async function takeoverConversation(id: string, agentName?: string) {
  await logActivity(id, `${agentName || "נציג"} השתלט על השיחה`);
  return getRepo().updateConversation(id, { status: "human" });
}

export async function releaseConversation(id: string, agentName?: string) {
  await logActivity(id, `${agentName || "נציג"} החזיר את השיחה לבוט`);
  return getRepo().updateConversation(id, {
    status: "bot",
    escalated: false,
    escalationReason: undefined,
    botPaused: false,
  });
}

export async function closeConversation(id: string, agentName?: string) {
  await logActivity(id, `${agentName || "נציג"} סגר את השיחה`);
  return getRepo().updateConversation(id, { status: "closed" });
}

/** מחיקת שיחה לצמיתות (למשל ניקוי שיחות בדיקה). כולל ההודעות והלקוח אם התרוקן. */
export async function deleteConversation(id: string): Promise<{ ok: true }> {
  await getRepo().deleteConversation(id);
  return { ok: true };
}

/** מיפוי ערוץ -> אדפטר שליחה. ל-playground אין אדפטר (הדפדפן מושך בעצמו). */
const CHANNEL_ADAPTERS: Record<string, ChannelAdapter | undefined> = {
  whatsapp: whatsappAdapter,
  messenger: messengerAdapter,
  instagram: instagramAdapter,
};

/** נציג אנושי שולח תשובה. בערוצים אמיתיים (וואטסאפ/מסנג'ר/אינסטגרם) גם נשלחת ללקוח. */
export async function agentReply(id: string, text: string, agentName?: string) {
  const repo = getRepo();
  const conversation = await repo.getConversation(id);
  if (!conversation) throw new Error("conversation not found");

  // מניעת שליחה כפולה: אם אותה תשובת נציג בדיוק נשמרה בשניות האחרונות
  // (לחיצה כפולה / retry של הדפדפן), מחזירים את הקיימת בלי לשלוח שוב ללקוח.
  const recent = await repo.getMessages(id, { limit: 10 });
  const dup = [...recent]
    .reverse()
    .find((m) => m.role === "agent" && m.content === text && Date.now() - m.ts < 15_000);
  if (dup) return dup;

  // משלוח בערוץ האמיתי לפני השמירה - אם השליחה נכשלת, הנציג יקבל שגיאה ויידע שלא נשלח
  const adapter = CHANNEL_ADAPTERS[conversation.channel];
  if (adapter) {
    const customer = await repo.getCustomer(conversation.customerId);
    if (customer) await adapter.sendText(customer.channelUserId, text, { humanAgent: true });
  }

  return repo.addMessage({
    conversationId: id,
    role: "agent",
    content: text,
    ts: Date.now(),
    meta: agentName ? { agentName } : undefined,
  });
}

/** השהיית/הפעלת הבוט לשיחה אחת בלבד (בלי לכבות אותו לכולם). */
export async function setConversationBotPaused(id: string, paused: boolean) {
  await logActivity(id, paused ? "הבוט הושהה בשיחה זו" : "הבוט הופעל מחדש בשיחה זו");
  return getRepo().updateConversation(id, { botPaused: paused });
}

// ----- ספריית מדיה -----
export async function getMediaLibrary(): Promise<MediaItem[]> {
  return loadMedia();
}
export async function setMediaLibrary(items: MediaItem[]): Promise<void> {
  await saveMedia(items);
}

// ----- בריאות הערוצים -----
export interface ChannelHealth {
  channel: string;
  configured: boolean;
  lastInbound?: number;
}
export async function getChannelHealth(): Promise<ChannelHealth[]> {
  const summaries = await getRepo().getConversationSummaries();
  const lastByChannel = new Map<string, number>();
  for (const s of summaries) {
    if (!s.lastUserTs) continue;
    const ch = s.conversation.channel;
    lastByChannel.set(ch, Math.max(lastByChannel.get(ch) ?? 0, s.lastUserTs));
  }
  const tokens: Record<string, string | undefined> = {
    whatsapp: process.env.WHATSAPP_ACCESS_TOKEN,
    messenger: process.env.MESSENGER_PAGE_ACCESS_TOKEN,
    instagram: process.env.INSTAGRAM_PAGE_ACCESS_TOKEN,
  };
  return ["whatsapp", "messenger", "instagram"].map((channel) => ({
    channel,
    configured: !!tokens[channel],
    lastInbound: lastByChannel.get(channel),
  }));
}

// ----- הצעת תשובה לנציג (טיוטה מהבוט) -----
/**
 * ליטוש ניסוח לתשובת נציג: לוקח את מה שהנציג כתב בשפה חופשית ומסגנן אותו
 * מקצועי וחם - בלי להמציא תשובה ובלי לשנות עובדות. בכשל מחזיר את המקור.
 */
export async function polishDraft(conversationId: string, draft: string): Promise<string> {
  const text = draft.trim();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || text.length < 2) return text;
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const model = process.env.CHATBOT_MODEL ?? "claude-sonnet-4-6";
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 15_000 });
  // ההודעה האחרונה של הלקוח - הקשר שעוזר להתאים פנייה ומגדר, לא לשנות תוכן
  const msgs = await getRepo().getMessages(conversationId, { limit: 20 });
  const lastUser = [...msgs].reverse().find((m) => m.role === "user")?.content ?? "";
  try {
    const res = await client.messages.create({
      model,
      max_tokens: 350,
      system:
        "אתה עורך לשוני של תשובות נציגי שירות בבית קפה איטלקי (קפה קוואלי). תקבל טיוטה שכתב נציג, " +
        "ותנסח אותה מחדש בעברית טבעית, מקצועית וחמה - כמו מארח אדיב. " +
        "כללי ברזל: שמור בדיוק על כל העובדות, המספרים, השעות, המחירים וההחלטות שבטיוטה - אסור להוסיף מידע, " +
        "הבטחות או הצעות שלא כתב הנציג, ואסור להשמיט דבר מהותי. שמור על אורך דומה (מותר קצת לקצר, לא להאריך). " +
        "בלי קו מפריד ארוך (—), מותר מקף רגיל. אם הטיוטה באנגלית - ענה באנגלית. " +
        "החזר אך ורק את הנוסח המשופר, בלי הקדמות ובלי הסברים.",
      messages: [
        {
          role: "user",
          content: `הודעת הלקוח האחרונה (להקשר בלבד):\n${lastUser.slice(0, 300)}\n\nהטיוטה של הנציג:\n${text}`,
        },
      ],
    });
    await recordLlmUsage(model, res.usage ?? {});
    const out = res.content?.[0]?.type === "text" ? res.content[0].text.trim() : "";
    // מעקה: תוצאה ריקה/חשודה באורכה - עדיף המקור של הנציג
    return out.length >= 2 && out.length <= text.length * 3 + 200 ? out : text;
  } catch {
    return text;
  }
}

export async function suggestReply(conversationId: string): Promise<string> {
  const msgs = await getRepo().getMessages(conversationId);
  // בניית היסטוריה ממוזגת (רצף תפקידים זהים = הודעה אחת), כפי שה-API דורש.
  // הודעות נציג מתויגות (כמו בזרימה הראשית) כדי שהמודל יבדיל בינן לבין דבריו.
  const merged: ConversationMessage[] = [];
  for (const m of msgs) {
    if (m.role !== "user" && m.role !== "assistant" && m.role !== "agent") continue;
    const role: "user" | "assistant" = m.role === "user" ? "user" : "assistant";
    const content = m.role === "agent" ? AGENT_MSG_PREFIX + m.content : m.content;
    const last = merged[merged.length - 1];
    if (last && last.role === role) last.content += "\n" + content;
    else merged.push({ role, content });
  }
  while (merged.length && merged[0].role === "assistant") merged.shift();
  // המודל דורש שההיסטוריה תסתיים בהודעת לקוח - מסירים תשובות בוט/נציג מהסוף,
  // כדי שהבוט יציע מענה לפנייה האחרונה של הלקוח.
  while (merged.length && merged[merged.length - 1].role === "assistant") merged.pop();
  if (!merged.length) return "";
  const result = await generateReply(merged, {});
  return result.text ?? "";
}

/** עדכון פרטי לקוח (תגיות, הערות, VIP, זיכרון) מהפאנל. */
export async function updateCustomerDetails(
  customerId: string,
  patch: { name?: string; vip?: boolean; tags?: string[]; notes?: string; memory?: string }
) {
  return getRepo().updateCustomer(customerId, patch);
}

// ----- עריכת המידע העסקי מהפאנל -----
export async function getBusinessConfig(): Promise<BusinessConfig> {
  return loadBusinessConfig();
}
export async function updateBusinessConfig(config: BusinessConfig): Promise<void> {
  await saveBusinessConfig(config);
}
export function defaultBusinessConfig(): BusinessConfig {
  return getDefaultBusinessConfig();
}

// ----- תבניות תשובה מהירות (Quick replies) -----
export interface QuickReply {
  title: string;
  text: string;
}
export async function getTemplates(): Promise<QuickReply[]> {
  const raw = await getRepo().getSetting("quick_replies");
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
export async function setTemplates(items: QuickReply[]): Promise<void> {
  await getRepo().setSetting("quick_replies", JSON.stringify(items));
}

/** ניהול הידע הנלמד: שאלות פתוחות + תשובות הצוות */
export async function listKnowledge(
  status?: "open" | "answered"
): Promise<LearnedQA[]> {
  return getRepo().listLearnedQA(status);
}
export async function answerKnowledge(id: string, answer: string) {
  // הצוות עונה בשפה חופשית - מנסחים מקצועית לפני השמירה (העובדות נשמרות אחד לאחד).
  // עריכה ידנית (updateKnowledge) לא עוברת ניסוח - מכבדים טקסט שנכתב בכוונה.
  const item = await getKnowledgeItem(id);
  const polished = await polishAnswer(item?.question ?? "", answer);
  return getRepo().answerLearnedQA(id, polished);
}
/** עריכת פריט ידע קיים (שאלה ו/או תשובה). הבוט משתמש בגרסה החדשה מהתור הבא. */
export async function updateKnowledge(
  id: string,
  patch: { question?: string; answer?: string }
) {
  return getRepo().updateLearnedQA(id, patch);
}
/** הוספת ידע יזומה מהפאנל (שאלה + תשובה מוכנות, בלי לחכות שלקוח ישאל). */
export async function createKnowledge(question: string, answer: string) {
  const qa = await getRepo().addOpenQuestion({ question: question.trim() });
  const polished = await polishAnswer(question.trim(), answer.trim());
  return getRepo().answerLearnedQA(qa.id, polished);
}
export async function getKnowledgeItem(id: string) {
  const all = await getRepo().listLearnedQA();
  return all.find((q) => q.id === id) ?? null;
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
  byChannel: { channel: string; count: number }[];
  peakHours: { hour: number; count: number }[]; // עומס לפי שעה ביום (שעון ישראל)
  /** על מה שואלים - פילוח נושאים דטרמיניסטי */
  byTopic: { topic: string; count: number }[];
  /** בקשות הזמנת מקום שממתינות לטיפול */
  pendingReservations: number;
  needsAttention: number; // שיחות שמחכות לטיפול אנושי
  openQuestions: number; // שאלות שממתינות לתשובת הצוות
  /** שיחות פתוחות שההודעה האחרונה בהן היא של הלקוח (ממתינות למענה כלשהו) */
  awaitingReplies: number;
}

export async function computeStats(): Promise<Stats> {
  const repo = getRepo();
  const [convs, msgs, summaries] = await Promise.all([
    repo.listConversations(),
    repo.getAllMessages(),
    repo.getConversationSummaries(),
  ]);
  const userMsgs = msgs.filter((m) => m.role === "user");
  const awaitingReplies = summaries.filter(
    (s) => s.lastMessageRole === "user" && s.conversation.status !== "closed"
  ).length;

  // פילוח נושאים: על מה הלקוחות שואלים (סיווג דטרמיניסטי, ראה insights.ts)
  const byTopic = topicBreakdown(userMsgs.map((m) => m.content)).slice(0, 8);

  const openQuestions = (await repo.listLearnedQA("open")).length;
  const pendingReservations = await countPendingReservations();
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

  // פילוח שיחות לפי ערוץ
  const channelCounts = new Map<string, number>();
  for (const c of convs) channelCounts.set(c.channel, (channelCounts.get(c.channel) ?? 0) + 1);
  const byChannel = [...channelCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([channel, count]) => ({ channel, count }));

  // עומס לפי שעה ביום (שעון ישראל) - מתוך הודעות הלקוחות
  const hourFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    hour12: false,
  });
  const hourCounts = new Array(24).fill(0) as number[];
  for (const m of userMsgs) {
    const h = parseInt(hourFmt.format(new Date(m.ts)), 10) % 24;
    if (!Number.isNaN(h)) hourCounts[h]++;
  }
  const peakHours = hourCounts.map((count, hour) => ({ hour, count }));

  return {
    totalConversations: total,
    byStatus,
    escalated,
    deflectionRate: total ? Math.round(((total - escalated) / total) * 100) : 0,
    totalUserMessages: userMsgs.length,
    last7Days,
    topWords,
    byChannel,
    peakHours,
    byTopic,
    pendingReservations,
    needsAttention: byStatus.human,
    openQuestions,
    awaitingReplies,
  };
}
