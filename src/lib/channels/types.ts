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
  /** שם השולח אם הערוץ מספק אותו בתוך ה-webhook (למשל וואטסאפ) */
  senderName?: string;
  /** תוכן ההודעה כטקסט (ריק אם זו הודעה קולית שעוד לא תומללה) */
  text: string;
  /** הודעה קולית/אודיו נכנסת - לתמלול. וואטסאפ נותן mediaId, מטא נותן URL ישיר. */
  audio?: { mediaId?: string; url?: string; mime?: string };
  /** מזהה ההודעה המקורית בערוץ (אם קיים) */
  messageId?: string;
  /** חותמת זמן (ms) */
  timestamp?: number;
}

/** ממשק אחיד שכל adapter של ערוץ מממש */
export interface ChannelAdapter {
  channel: Channel;
  /** שולח טקסט חזרה למשתמש בערוץ */
  sendText(
    recipientId: string,
    text: string,
    opts?: {
      /** תשובת נציג אנושי: במסנג'ר/אינסטגרם מאפשר ניסיון חוזר עם תג HUMAN_AGENT (חלון 7 ימים) */
      humanAgent?: boolean;
    }
  ): Promise<void>;
  /** מציג "מקליד..." (אם הערוץ תומך) */
  sendTyping?(recipientId: string): Promise<void>;
  /** שולף את שם הפרופיל של המשתמש (אם הערוץ תומך, למשל דרך Graph API) */
  getProfileName?(userId: string): Promise<string | undefined>;
  /** שולח מדיה (תמונה/סרטון) לפי כתובת URL ציבורית */
  sendMedia?(recipientId: string, url: string, type: "image" | "video"): Promise<void>;
}
