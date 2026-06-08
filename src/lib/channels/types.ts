/**
 * שכבת ההפשטה של הערוצים.
 *
 * כל פלטפורמה (וואטסאפ, מסנג'ר, אינסטגרם, וגם ה-Playground) ממירה את
 * ההודעות שלה לפורמט האחיד הזה. כך ש"המוח" של הבוט לא יודע ולא מתעניין
 * מאיזה ערוץ ההודעה הגיעה — מה שמאפשר לבדוק הכל בלי מטא.
 */

export type Channel = "whatsapp" | "messenger" | "instagram" | "playground";

/** הודעה אחת בשיחה, בפורמט שמתאים גם ל-Claude API */
export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

/** הודעה נכנסת אחרי נרמול מהערוץ */
export interface IncomingMessage {
  channel: Channel;
  /** מזהה ייחודי של השולח בתוך הערוץ (מספר טלפון / PSID / IG id) */
  senderId: string;
  /** תוכן ההודעה כטקסט */
  text: string;
  /** מזהה ההודעה המקורית בערוץ (אם קיים) */
  messageId?: string;
  /** חותמת זמן (ms) */
  timestamp?: number;
}

/** ממשק אחיד שכל adapter של ערוץ מממש */
export interface ChannelAdapter {
  channel: Channel;
  /** שולח טקסט חזרה למשתמש בערוץ */
  sendText(recipientId: string, text: string): Promise<void>;
}
