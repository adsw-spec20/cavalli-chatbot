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
/** מי שאל שאלה (לקפיצה לשיחה ול"שלח את התשובה ללקוח") */
export interface QAAsker {
  conversationId: string;
  name?: string;
  ts: number;
  /** האם התשובה כבר נשלחה ללקוח הזה מהפאנל */
  answerSent?: boolean;
}

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
  /** כמה פעמים נשאלה (כפילויות סמנטיות מאוחדות לשורה אחת) */
  count?: number;
  /** כל מי ששאל את השאלה */
  askers?: QAAsker[];
  /** נושא (סיווג אוטומטי - ראה insights.ts) */
  topic?: string;
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
  /** אופציונלי: ה-UI לא מציג אותו, ומימוש Postgres מדלג על הספירה (יקרה) */
  messageCount?: number;
}

/** אירוע שער ליומן הדשבורד (נגזר מהודעות מערכת עם meta מתאים) */
export interface GateEvent {
  ts: number;
  conversationId: string;
  customerName?: string;
  channel: string;
  /** opened = נפתח; blocked = נחסם (שעות/מגבלה/וטו); error = כשל טכני */
  result: "opened" | "blocked" | "error";
  /** תיאור קצר (תוכן הודעת המערכת) */
  detail: string;
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
  /** מחיקה לצמיתות של שיחה והודעותיה; לקוח שנשאר בלי שיחות נמחק גם הוא */
  deleteConversation(id: string): Promise<void>;

  // ----- הודעות -----
  /**
   * שמירת הודעה. מחזיר null אם ההודעה נדחתה על ידי אינדקס ייחודיות
   * (למשל mid שכבר נשמר על ידי שרת מקביל - משלוח כפול של מטא):
   * null = "שרת אחר מטפל בהודעה הזאת, עצור".
   */
  addMessage(msg: Omit<StoredMessage, "id">): Promise<StoredMessage | null>;
  /** limit: מחזיר רק את N ההודעות האחרונות (בסדר כרונולוגי) - לפאנל במובייל */
  getMessages(conversationId: string, opts?: { limit?: number }): Promise<StoredMessage[]>;
  getAllMessages(): Promise<StoredMessage[]>;

  // ----- תחזוקה ותצפית -----
  /**
   * מיזוג שיחה כפולה: מעביר את כל ההודעות אל שיחת היעד, מעדכן את זמן
   * העדכון של היעד לגדול מביניהם, ומוחק את שורת שיחת המקור (בלי לגעת
   * בהודעות וב-לקוח). בטוח להרצה חוזרת.
   */
  mergeConversationInto(fromId: string, toId: string): Promise<void>;
  /** מחיקת עותקים כפולים של אותה הודעת ערוץ (אותו mid) בשיחה - משאיר את הראשון */
  dedupeMessagesByMid(conversationId: string): Promise<number>;
  /** אירועי שער (פתיחות/חסימות/כשלים) מכל השיחות, מהחדש לישן - ליומן בדשבורד */
  listGateEvents(limit: number): Promise<GateEvent[]>;

  // ----- ידע נלמד (שאלות פתוחות + תשובות) -----
  addOpenQuestion(data: {
    question: string;
    conversationId?: string;
    askerName?: string;
    topic?: string;
  }): Promise<LearnedQA>;
  /** רישום שאילה חוזרת של שאלה קיימת (מגדיל מונה ומוסיף שואל) */
  recordLearnedQAAsk(id: string, asker: QAAsker): Promise<void>;
  /** עדכון רשימת השואלים (למשל סימון שהתשובה נשלחה ללקוח) */
  setLearnedQAAskers(id: string, askers: QAAsker[]): Promise<void>;
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
