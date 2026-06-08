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
  /** האם הסכים לקבל הודעות יזומות (תזכורות/ביקורות) */
  optInMarketing?: boolean;
  firstSeen: number;
  lastSeen: number;
  /** הערות חופשיות שהצוות יכול להוסיף */
  notes?: string;
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
  /** דירוג שביעות רצון 1-5 אם נאסף */
  csat?: number;
  meta?: Record<string, unknown>;
}

export interface ConversationFilter {
  status?: ConversationStatus;
  channel?: Channel;
  escalated?: boolean;
}

export interface Repository {
  // ----- לקוחות -----
  upsertCustomer(
    customer: Omit<Customer, "firstSeen" | "lastSeen"> &
      Partial<Pick<Customer, "firstSeen" | "lastSeen">>
  ): Promise<Customer>;
  getCustomer(id: string): Promise<Customer | null>;

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

  // ----- הודעות -----
  addMessage(msg: Omit<StoredMessage, "id">): Promise<StoredMessage>;
  getMessages(conversationId: string): Promise<StoredMessage[]>;
  getAllMessages(): Promise<StoredMessage[]>;
}
