/**
 * זיכרון לקוח חוזר.
 *
 * הבוט מתחזק "כרטיס זיכרון" קצר לכל לקוח - תמצית של מה שחשוב לזכור בין שיחות
 * (שם/כינוי, העדפות, רגישויות, הרגלים, בקשות חוזרות). בשיחה הבאה התמצית מוזרקת
 * ל-System Prompt כדי לתת יחס אישי וטבעי (בלי להכריז "אני זוכר ש...").
 *
 * העדכון רץ ברקע (אחרי שהתשובה כבר נשלחה ללקוח) כדי לא להוסיף זמן תגובה,
 * ומווסת בתדירות (לא בכל הודעה) כדי לחסוך בעלות. משתמש ב-Haiku - זול ומספיק.
 */

import Anthropic from "@anthropic-ai/sdk";
import { getRepo } from "./db";
import { recordLlmUsage } from "./usage";
import type { StoredMessage } from "./db/types";

// מודל זול לתמצות; אפשר לעקוף דרך MEMORY_MODEL.
const MEMORY_MODEL = process.env.MEMORY_MODEL ?? "claude-haiku-4-5-20251001";
const MEMORY_MAX_TOKENS = 220;
const MEMORY_MAX_CHARS = 600; // תקרה לאורך הזיכרון השמור (זול בהזרקה)

// ויסות: מתי לעדכן זיכרון
const MIN_USER_MSGS = 2; // לפחות כך הרבה הודעות לקוח לפני שיוצרים זיכרון
const REFRESH_EVERY = 3; // לרענן רק כל כך הרבה הודעות לקוח חדשות מאז העדכון האחרון
const TRANSCRIPT_TURNS = 20; // כמה הודעות אחרונות לקרוא לתמצות

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  if (!client) client = new Anthropic({ apiKey });
  return client;
}

/**
 * מזריק את זיכרון הלקוח כבלוק הקשר ל-System Prompt (אם קיים).
 * ההנחיה: להשתמש בעדינות ובטבעיות, בלי להכריז שזוכרים.
 */
export function memoryContextBlock(memory?: string): string | undefined {
  const m = memory?.trim();
  if (!m) return undefined;
  return (
    "# מה שאנחנו כבר יודעים על הלקוח (משיחות קודמות)\n" +
    `${m}\n` +
    "השתמש במידע הזה **בעדינות ובטבעיות** כדי לתת יחס אישי והמשכיות - " +
    "למשל להתחשב בהעדפות שלו. **אל תכריז** 'אני זוכר ש...' ואל תצטט " +
    "את הכרטיס; פשוט תן לזה לבוא לידי ביטוי בשיחה כמו מארח שמכיר את האורח. " +
    "**לעולם אל תפנה ללקוח בשמו** - גם אם שם מופיע כאן או בשיחה. " +
    "אם המידע לא רלוונטי לשאלה הנוכחית, התעלם ממנו."
  );
}

function buildTranscript(messages: StoredMessage[]): string {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "agent")
    .slice(-TRANSCRIPT_TURNS)
    .map((m) => `${m.role === "user" ? "לקוח" : "בוט/נציג"}: ${m.content}`)
    .join("\n");
}

/**
 * מעדכן (או יוצר) את כרטיס הזיכרון של הלקוח, אם חצינו את סף הוויסות.
 * רץ ברקע - לא חוסם ולא מעלה את זמן התגובה ללקוח. כשל נבלע בשקט.
 */
export async function maybeUpdateCustomerMemory(conversationId: string): Promise<void> {
  if (!conversationId) return;
  const anthropic = getClient();
  if (!anthropic) return;

  try {
    const repo = getRepo();
    const conversation = await repo.getConversation(conversationId);
    if (!conversation) return;
    const customer = await repo.getCustomer(conversation.customerId);
    if (!customer) return;

    const messages = await repo.getMessages(conversationId);
    const userMsgs = messages.filter((m) => m.role === "user");
    if (userMsgs.length < MIN_USER_MSGS) return;

    // ויסות: אם כבר יש זיכרון, לרענן רק אחרי מספיק הודעות חדשות
    const newSince = userMsgs.filter(
      (m) => m.ts > (customer.memoryUpdatedAt ?? 0)
    ).length;
    if (customer.memory && newSince < REFRESH_EVERY) return;

    const transcript = buildTranscript(messages);
    if (!transcript.trim()) return;

    const existing = customer.memory?.trim();
    const userContent =
      (existing ? `כרטיס הזיכרון הקיים:\n${existing}\n\n` : "") +
      `קטע מהשיחה (העדכנית ביותר בסוף):\n${transcript}\n\n` +
      "עדכן את כרטיס הזיכרון: שלב את מה שכבר ידוע עם מה שחדש, והחזר גרסה מעודכנת.";

    const res = await anthropic.messages.create({
      model: MEMORY_MODEL,
      max_tokens: MEMORY_MAX_TOKENS,
      system:
        "אתה מתחזק 'כרטיס זיכרון' קצר על לקוח של בית קפה, לטובת שיחות עתידיות. " +
        "כתוב 1-3 משפטים קצרים בעברית עם מה שבאמת שווה לזכור: שם/כינוי, העדפות " +
        "(מנות/משקאות אהובים), רגישויות או אלרגיות שהוזכרו, הרגלים (בא עם ילדים/בן זוג), " +
        "ובקשות חוזרות. כתוב תמצית עניינית בגוף שלישי, לא שיחה מלאה ולא ציטוטים. " +
        "אל תכלול מידע רגיש מיותר ואל תמציא דבר שלא נאמר. " +
        "אם אין שום דבר שווה-זכירה, החזר מחרוזת ריקה.",
      messages: [{ role: "user", content: userContent }],
    });

    // רישום העלות של תמצות הזיכרון (Haiku) - נספר במד העלות אבל לא כ"תשובה"
    await recordLlmUsage(MEMORY_MODEL, res.usage, false);

    const block = res.content.find((b) => b.type === "text");
    let memory = block && block.type === "text" ? block.text.trim() : "";
    if (memory.length > MEMORY_MAX_CHARS) memory = memory.slice(0, MEMORY_MAX_CHARS).trim();

    // אם המודל החזיר ריק/קצר מדי, לא דורסים זיכרון קיים - רק מעדכנים חותמת
    if (memory.length < 4) {
      await repo.updateCustomer(customer.id, { memoryUpdatedAt: Date.now() });
      return;
    }

    await repo.updateCustomer(customer.id, {
      memory,
      memoryUpdatedAt: Date.now(),
    });
  } catch (err) {
    console.error("[customer-memory] עדכון זיכרון נכשל:", err);
  }
}
