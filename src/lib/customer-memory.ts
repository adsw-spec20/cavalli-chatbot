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
import { formatMemoryForPrompt, serializeMemory } from "./customer-memory-format";
import type { StoredMessage } from "./db/types";

// מודל זול לתמצות; אפשר לעקוף דרך MEMORY_MODEL.
const MEMORY_MODEL = process.env.MEMORY_MODEL ?? "claude-haiku-4-5-20251001";
const MEMORY_MAX_TOKENS = 300;
const PREF_MAX_CHARS = 400; // תקרה לאורך שדה ההעדפות
const WARN_MAX_CHARS = 160; // תקרה לאורך אזהרה בודדת

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
  const formatted = formatMemoryForPrompt(memory);
  if (!formatted) return undefined;
  return (
    "# מה שאנחנו כבר יודעים על הלקוח (משיחות קודמות)\n" +
    `${formatted}\n` +
    "השתמש במידע הזה **בעדינות ובטבעיות** כדי לתת יחס אישי והמשכיות - " +
    "למשל להתחשב בהעדפות שלו. **אל תכריז** 'אני זוכר ש...' ואל תצטט " +
    "את הכרטיס; פשוט תן לזה לבוא לידי ביטוי בשיחה כמו מארח שמכיר את האורח. " +
    "**לעולם אל תפנה ללקוח בשמו** - גם אם שם מופיע כאן או בשיחה. " +
    "אם המידע לא רלוונטי לשאלה הנוכחית, התעלם ממנו."
  );
}

// כלי לפלט מובנה: מכריח את המודל להחזיר אזהרות והעדפות בשדות נפרדים,
// במקום פסקת טקסט חופשי (שהדליפה כוכביות והכניסה פרטי הזמנה חד-פעמיים).
const MEMORY_TOOL: Anthropic.Tool = {
  name: "save_customer_memory",
  description: "שמור את כרטיס הזיכרון המובנה של הלקוח לטובת שיחות עתידיות.",
  input_schema: {
    type: "object",
    properties: {
      warnings: {
        type: "array",
        items: { type: "string" },
        description:
          "אזהרות אמיתיות בלבד שהצוות באמת צריך לשים לב אליהן, אם עלו במפורש: אלרגיה או רגישות למאכל שהלקוח ציין, תלונה שלא נפתרה, חשש מפורש לגבי תשלום/פיקדון, או בקשה מיוחדת מפורשת. משפט אחד קצר, פשוט ותקני בעברית לכל אחת, קרוב למילות הלקוח. **מערך ריק כברירת מחדל** - רוב הלקוחות לא צריכים אף אזהרה. אל תסמן כאזהרה פעולות שגרה (פתיחת שער, הזמנת מקום, שאלות כלליות על שעות/מיקום/תפריט). אל תמציא.",
      },
      preferences: {
        type: "string",
        description:
          "העדפות והרגלים קבועים של הלקוח, אם עלו: מנות/משקאות אהובים, ישיבה בפנים/בחוץ, מגיע עם ילדים/בן זוג, שם/כינוי שמסר. משפט קצר אחד בעברית תקנית, בגוף שלישי. מחרוזת ריקה אם אין. אל תכלול פרטי הזמנה חד-פעמית.",
      },
    },
    required: ["warnings", "preferences"],
  },
};

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

    // מציגים למודל את הזיכרון הקיים כטקסט קריא (לא JSON גולמי)
    const existing = formatMemoryForPrompt(customer.memory);
    const userContent =
      (existing ? `כרטיס הזיכרון הקיים:\n${existing}\n\n` : "") +
      `קטע מהשיחה (העדכנית ביותר בסוף):\n${transcript}\n\n` +
      "עדכן את כרטיס הזיכרון: שלב את מה שכבר ידוע עם מה שחדש, וקרא לכלי עם הגרסה המעודכנת.";

    const res = await anthropic.messages.create({
      model: MEMORY_MODEL,
      max_tokens: MEMORY_MAX_TOKENS,
      system:
        "אתה מתחזק 'כרטיס זיכרון' מובנה על לקוח של בית קפה, לטובת שיחות עתידיות. קרא לכלי save_customer_memory. " +
        "שדה warnings מיועד ל**אזהרות אמיתיות בלבד** שהצוות באמת צריך לשים לב אליהן: אלרגיה/רגישות למאכל שהלקוח ציין, " +
        "תלונה שלא נפתרה, חשש מפורש לגבי תשלום או פיקדון, או בקשה מיוחדת מפורשת. **ברירת המחדל היא מערך ריק** - " +
        "רוב הלקוחות לא צריכים אף אזהרה. **לעולם אל תסמן כאזהרה פעולות שגרה**: פתיחת שער, הזמנת מקום רגילה, " +
        "או שאלות כלליות (שעות/מיקום/תפריט) - אלה שגרה, לא אזהרות. אם אין אזהרה אמיתית ומפורשת - warnings ריק. " +
        "שדה preferences: העדפות/הרגלים קבועים (מנה אהובה, ישיבה בחוץ, בא עם ילדים) - ריק אם אין. " +
        "כתוב בעברית פשוטה, תקנית וטבעית, קרובה למילות הלקוח עצמו. הקפד על דקדוק והתאמת מין. " +
        "אל תמציא, אל תתרגם מושגים מאנגלית, ואל תכניס פרטי הזמנה (תאריך/שעה/כמות - מנוהלים בנפרד). " +
        "אם אינך בטוח איך לנסח משהו בעברית תקנית - עדיף להשמיט אותו מאשר לכתוב ניסוח שגוי.",
      tools: [MEMORY_TOOL],
      tool_choice: { type: "tool", name: "save_customer_memory" },
      messages: [{ role: "user", content: userContent }],
    });

    // רישום העלות של תמצות הזיכרון (Haiku) - נספר במד העלות אבל לא כ"תשובה"
    await recordLlmUsage(MEMORY_MODEL, res.usage, false);

    const toolUse = res.content.find((b) => b.type === "tool_use");
    const input =
      toolUse && toolUse.type === "tool_use"
        ? (toolUse.input as { warnings?: unknown; preferences?: unknown })
        : {};
    const warnings = Array.isArray(input.warnings)
      ? input.warnings
          .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
          .map((x) => x.trim().slice(0, WARN_MAX_CHARS))
          .slice(0, 6)
      : [];
    const preferences =
      typeof input.preferences === "string" ? input.preferences.trim().slice(0, PREF_MAX_CHARS) : "";

    const memory = serializeMemory({ warnings, preferences });

    // אם המודל החזיר ריק, לא דורסים זיכרון קיים - רק מעדכנים חותמת
    if (!memory) {
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
