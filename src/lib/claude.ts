/**
 * הלקוח של Claude — זה ה"מוח" של הבוט.
 *
 * מקבל היסטוריית שיחה, מצרף את ה-System Prompt שנבנה מהקונפיג, ומחזיר תשובה.
 * זהה לחלוטין לכל הערוצים (וואטסאפ/מסנג'ר/אינסטגרם/Playground).
 */

import Anthropic from "@anthropic-ai/sdk";
import { businessConfig } from "./business-config";
import { buildSystemPrompt } from "./system-prompt";
import { buildMenuContext } from "./knowledge-retrieval";
import type { ConversationMessage } from "./channels/types";

// מודל ברירת מחדל: Sonnet 4.6 - עברית נקייה ומדויקת, מתאים לבוט שמדבר עם לקוחות.
// העלות האמיתית נמוכה הודות ל-prompt caching. אפשר לעקוף דרך CHATBOT_MODEL
// (למשל "claude-haiku-4-5-20251001" לזול יותר, אם מוכנים לגליצ'ים זעירים בעברית).
const MODEL = process.env.CHATBOT_MODEL ?? "claude-sonnet-4-6";
const MAX_TOKENS = 1024;

/**
 * התאריך והשעה הנוכחיים בישראל (אזור זמן Asia/Jerusalem, כולל שעון קיץ אוטומטי).
 * מוזרק לבוט בכל הודעה כדי שיידע איזה יום היום ומה השעה, ויוכל לדעת אם פתוח עכשיו.
 */
function israelDateTime(): string {
  const formatted = new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  return formatted;
}

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "חסר ANTHROPIC_API_KEY. הוסף אותו לקובץ .env.local (ראה .env.example)."
      );
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

export interface GenerateOptions {
  /** האם זו ההודעה הראשונה בשיחה (כדי לשלב את גילוי ה-AI בלי ברכה כפולה) */
  firstTurn?: boolean;
}

export interface GenerateResult {
  /** טקסט התשובה (null אם המודל בחר רק להסלים) */
  text: string | null;
  /** אם המודל החליט להעביר לנציג אנושי */
  escalate?: { reason: string; summary: string };
}

// כלי שמאפשר למודל להחליט מתי להעביר לנציג אנושי, עם סיכום לטובת הנציג.
const ESCALATE_TOOL: Anthropic.Tool = {
  name: "escalate_to_human",
  description:
    "העבר את השיחה לנציג אנושי. קרא לכלי הזה רק אחרי שניסית לעזור בעצמך, וכשהלקוח מתעקש על נציג, מתלונן, כועס, או כשמדובר בנושא שאתה לא יכול לטפל בו. אל תקרא לו על שאלה רגילה שאתה יכול לענות עליה.",
  input_schema: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        description: "סיבת ההעברה בקצרה (למשל: בקשת נציג, תלונה, אירוע פרטי)",
      },
      summary: {
        type: "string",
        description:
          "סיכום קצר בעברית של מה שהלקוח צריך או הבעיה שלו, כדי שהנציג האנושי יקבל הקשר מלא ולא יצטרך לשאול מהתחלה.",
      },
    },
    required: ["reason", "summary"],
  },
};

/**
 * מקבל את היסטוריית השיחה ומחזיר את תשובת הבוט, או החלטה להסלים לנציג.
 */
export async function generateReply(
  history: ConversationMessage[],
  options: GenerateOptions = {}
): Promise<GenerateResult> {
  const anthropic = getClient();

  const systemPrompt = buildSystemPrompt(businessConfig);

  // שליפה חכמה: מצרפים רק את קטגוריות התפריט הרלוונטיות לשיחה האחרונה.
  const recentText = history
    .slice(-4)
    .map((m) => m.content)
    .join("\n");
  const menuContext = buildMenuContext(businessConfig, recentText);

  const systemBlocks: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text: systemPrompt,
      // נקודת המטמון: ה-System Prompt הקבוע נשמר, והבלוקים הדינמיים שאחריו לא שוברים אותו.
      cache_control: { type: "ephemeral" },
    },
  ];
  if (menuContext) {
    systemBlocks.push({ type: "text", text: menuContext });
  }
  systemBlocks.push({
    type: "text",
    text: `המועד הנוכחי בישראל (שעון מקומי): ${israelDateTime()}.`,
  });
  if (options.firstTurn) {
    systemBlocks.push({
      type: "text",
      text: `הערה: זו ההודעה הראשונה בשיחה. שלב בתשובתך, באופן טבעי וזורם ובמשפט קצר, גילוי שאתה העוזר הדיגיטלי (AI) של "${businessConfig.name}" ושבכל שלב אפשר לבקש נציג אנושי. שלב את זה כחלק מהמענה, לא כהודעה נפרדת ולא כתבנית קבועה, וכל פעם בניסוח מעט אחר. הכי חשוב: אם הלקוח כבר שאל שאלה, ענה עליה ישירות. אל תשאל "איך אפשר לעזור" כשהוא כבר אמר לך מה הוא צריך. תחשוב מה מתאים לענות, אל תהיה רובוטי.`,
    });
  }

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemBlocks,
    tools: [ESCALATE_TOOL],
    messages: history.map((m) => ({ role: m.role, content: m.content })),
  });

  // לוג עלות (טוקנים) - עוזר לראות שהחיסכון עובד. רק בפיתוח.
  if (process.env.NODE_ENV !== "production") {
    const u = response.usage;
    console.log(
      `[cost] in=${u.input_tokens} cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0} out=${u.output_tokens}`
    );
  }

  const toolUse = response.content.find((b) => b.type === "tool_use");
  const textBlock = response.content.find((b) => b.type === "text");
  const text = textBlock && textBlock.type === "text" ? textBlock.text : null;

  if (toolUse && toolUse.type === "tool_use" && toolUse.name === "escalate_to_human") {
    const input = toolUse.input as { reason: string; summary: string };
    return { text, escalate: { reason: input.reason, summary: input.summary } };
  }

  return { text };
}
