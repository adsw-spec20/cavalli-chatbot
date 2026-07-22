/**
 * מודל הנתונים וממשק ה-Repository.
 *
 * כל הגישה לנתונים עוברת דרך הממשק הזה (async), כך שאפשר להחליף את המימוש
 * מאחורי הקלעים: כרגע אחסון מבוסס-קובץ לפיתוח, ובפרודקשן Postgres/Redis,
 * בלי לשנות את שאר הקוד.
 */

import type { Channel } from "../channels/types";

export type ConversationStatus = "bot" | "human" | "closed";

export type MessageRole = "user" | "assistant" | "agent" | "system";

export interface Customer {
  /** מזהה ייחודי, למשל "whatsapp:97250..." או "playground:uuid" */
  id: string;
  channel: Channel;
  /** המזהה בתוך הערוץ (מספר טלפון / PSID / IG id) */
  channelUserId: string;
  name?: string;
  /** לקוח VIP - יקבל עדיפות בהעברה לאדם */
  vip?: boolean;
  /** תגיות חופשיות שהצוות מוסיף (קבוע / תלונה / ליד לאירוע וכו') */
  tags?: string[];
  /** האם הסכים לקבל הודעות יזומות (תזכורות/ביקורות) */
  optInMarketing?: boolean;
  firstSeen: number;
  lastSeen: number;
  /** הערות חופשיות שהצוות יכול להוסיף */
  notes?: string;
  /** "כרטיס זיכרון" שהבוט מתחזק על הלקוח (תמצית להמשכיות בין שיחות) */
  memory?: string;
  /** מתי עודכן הזיכרון לאחרונה (ms) - לוויסות תדירות העדכון */
  memoryUpdatedAt?: number;
}

export interface StoredMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  ts: number;
  /** מטא-דאטה: למשל { transcribedFromVoice: true } או { escalation: true } */
  meta?: Record<string, unknown>;
}

export interface Conversation {
  id: string;
  channel: Channel;
  customerId: string;
  /** bot = הבוט עונה · human = נציג אנושי השתלט · closed = נסגרה */
  status: ConversationStatus;
  createdAt: number;
  updatedAt: number;
  /** האם הוסלמה לאדם, ולמה */
  escalated?: boolean;
  escalationReason?: string;
  /** סיכום שהבוט מכין לנציג האנושי (הקשר על מה שהלקוח צריך) */
  escalationSummary?: string;
  /** האם נשלח גילוי "אני בוט AI" (תאימות Meta) */
  disclosedAi?: boolean;
  /** הבוט מושהה לשיחה הזו בלבד (נציג מטפל ידנית בלי לכבות את הבוט לכולם) */
  botPaused?: boolean;
  /** דירוג שביעות רצון 1-5 אם נאסף */
  csat?: number;
  meta?: Record<string, unknown>;
}

export interface ConversationFilter {
  status?: ConversationStatus;
  channel?: Channel;
  escalated?: boolean;
}

/**
 * שאלה שהבוט לא ידע לענות עליה (status=open), והתשובה שבעל העסק נתן (answered).
 * שאלות שנענו מוזרקות לידע של הבוט כדי שיידע לענות בפעם הבאה.
 */
export interface LearnedQA {
  id: string;
  question: string;
  answer: string | null;
  status: "open" | "answered";
  conversationId?: string;
  createdAt: number;
  answeredAt?: number;
  /** עדכון אחרון של שאלה/תשובה מהפאנל (לעריכה ולמניעת דריסה מקבילה) */
  updatedAt?: number;
}

/**
 * שורת סיכום לרשימת השיחות בפאנל: כל מה שהאינבוקס צריך בשאילתה אחת,
 * בלי למשוך את כל ההודעות (קריטי לביצועים כשיש אלפי הודעות).
 */
export interface ConversationSummary {
  conversation: Conversation;
  customerName?: string;
  customerVip?: boolean;
  customerTags?: string[];
  /** ההודעה האחרונה שאינה system (קטומה להצגה) */
  lastMessage?: string;
  lastMessageRole?: MessageRole;
  /** חותמת ההודעה האחרונה של הלקוח (לחישוב זמן המתנה) */
  lastUserTs?: number;
  messageCount: number;
}

export interface Repository {
  // ----- לקוחות -----
  upsertCustomer(
    customer: Omit<Customer, "firstSeen" | "lastSeen"> &
      Partial<Pick<Customer, "firstSeen" | "lastSeen">>
  ): Promise<Customer>;
  getCustomer(id: string): Promise<Customer | null>;
  updateCustomer(id: string, patch: Partial<Customer>): Promise<Customer | null>;

  // ----- שיחות -----
  createConversation(
    data: Omit<Conversation, "createdAt" | "updatedAt">
  ): Promise<Conversation>;
  getConversation(id: string): Promise<Conversation | null>;
  updateConversation(
    id: string,
    patch: Partial<Conversation>
  ): Promise<Conversation | null>;
  listConversations(filter?: ConversationFilter): Promise<Conversation[]>;
  /** רשימת שיחות + נתוני תצוגה לאינבוקס בשאילתה יעילה אחת */
  getConversationSummaries(): Promise<ConversationSummary[]>;

  // ----- הודעות -----
  addMessage(msg: Omit<StoredMessage, "id">): Promise<StoredMessage>;
  getMessages(conversationId: string): Promise<StoredMessage[]>;
  getAllMessages(): Promise<StoredMessage[]>;

  // ----- ידע נלמד (שאלות פתוחות + תשובות) -----
  addOpenQuestion(data: {
    question: string;
    conversationId?: string;
  }): Promise<LearnedQA>;
  listLearnedQA(status?: "open" | "answered"): Promise<LearnedQA[]>;
  answerLearnedQA(id: string, answer: string): Promise<LearnedQA | null>;
  /** עריכת שאלה/תשובה קיימת (הבוט משתמש בגרסה המעודכנת מיידית) */
  updateLearnedQA(
    id: string,
    patch: { question?: string; answer?: string }
  ): Promise<LearnedQA | null>;
  deleteLearnedQA(id: string): Promise<void>;

  // ----- הגדרות מערכת (key-value), למשל כפתור כיבוי הבוט -----
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
}
