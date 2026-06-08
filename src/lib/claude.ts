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

export interface LearnedFaq {
  question: string;
  answer: string;
}

export interface GenerateOptions {
  /** האם זו ההודעה הראשונה בשיחה (כדי לשלב את גילוי ה-AI בלי ברכה כפולה) */
  firstTurn?: boolean;
  /** שאלות שנענו על ידי הצוות, מוזרקות לידע של הבוט */
  learnedFaqs?: LearnedFaq[];
}

export interface GenerateResult {
  /** טקסט התשובה (null אם המודל בחר רק להסלים) */
  text: string | null;
  /** אם המודל החליט להעביר לנציג אנושי */
  escalate?: { reason: string; summary: string };
  /** שאלות עסקיות שהבוט לא ידע לענות עליהן (לתיעוד באדמין ולמידה) */
  unknownQuestions?: string[];
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

// כלי לתיעוד שאלה עסקית שאין עליה תשובה, כדי שהצוות יענה והבוט ילמד.
const LOG_UNKNOWN_TOOL: Anthropic.Tool = {
  name: "log_unanswered_question",
  description:
    "תעד שאלה של לקוח שקשורה לעסק אבל אין לך עליה תשובה במידע שברשותך (פרט שלא מופיע בתפריט/במידע). קרא לכלי הזה כדי שהצוות יוכל לענות בעתיד, ובמקביל ענה ללקוח בכנות שאין לך את המידע וכדאי לברר מול הצוות. אל תשתמש בו לשאלות שאתה כן יכול לענות עליהן, ולא לשאלות שלא קשורות לעסק.",
  input_schema: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "ניסוח תמציתי וברור של השאלה שהלקוח שאל ואין עליה תשובה.",
      },
    },
    required: ["question"],
  },
};

/**
 * מקבל את היסטוריית השיחה ומחזיר את תשובת הבוט, או החלטה להסלים לנציג.
 * תומך בלולאת tool-use: אם המודל מתעד שאלה לא ידועה, ממשיכים עד לקבלת תשובה ללקוח.
 */
export async function generateReply(
  history: ConversationMessage[],
  options: GenerateOptions = {}
): Promise<GenerateResult> {
  const anthropic = getClient();

  const systemPrompt = buildSystemPrompt(businessConfig);

  const recentText = history
    .slice(-4)
    .map((m) => m.content)
    .join("\n");
  const menuContext = buildMenuContext(businessConfig, recentText);

  const systemBlocks: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text: systemPrompt,
      cache_control: { type: "ephemeral" },
    },
  ];
  if (menuContext) {
    systemBlocks.push({ type: "text", text: menuContext });
  }
  if (options.learnedFaqs && options.learnedFaqs.length) {
    const faqText = options.learnedFaqs
      .map((f) => `  שאלה: ${f.question}\n  תשובה: ${f.answer}`)
      .join("\n\n");
    systemBlocks.push({
      type: "text",
      text: `# ידע נוסף שהצוות הוסיף (השתמש בו כמו בשאר המידע על העסק)\n${faqText}`,
    });
  }
  systemBlocks.push({
    type: "text",
    text: `המועד הנוכחי בישראל (שעון מקומי): ${israelDateTime()}.`,
  });
  if (options.firstTurn) {
    systemBlocks.push({
      type: "text",
      text: `הערה: זו ההודעה הראשונה בשיחה. הגב בחום ובטבעיות, כמו מארח אמיתי. שזור במשפט קצר וזורם את העובדה שאתה העוזר הדיגיטלי (AI) של "${businessConfig.name}" ושאפשר לבקש נציג אנושי בכל שלב, אבל בעדינות ובדרך אגב, לא ככותרת פותחת ולא כתבנית קבועה, וכל פעם קצת אחרת. אם הלקוח כבר שאל שאלה, ענה עליה ישר ואל תשאל "איך אפשר לעזור". אם הוא רק בירך, החזר ברכה חמה וקצרה והזמן אותו לשאול. קצר, אנושי, בלי משפטים שיווקיים.`,
    });
  }

  const messages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const unknownQuestions: string[] = [];

  for (let i = 0; i < 3; i++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemBlocks,
      tools: [ESCALATE_TOOL, LOG_UNKNOWN_TOOL],
      messages,
    });

    if (process.env.NODE_ENV !== "production") {
      const u = response.usage;
      console.log(
        `[cost] in=${u.input_tokens} cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0} out=${u.output_tokens}`
      );
    }

    const textBlock = response.content.find((b) => b.type === "text");
    const text = textBlock && textBlock.type === "text" ? textBlock.text : null;
    const escalateUse = response.content.find(
      (b) => b.type === "tool_use" && b.name === "escalate_to_human"
    );
    const logUses = response.content.filter(
      (b) => b.type === "tool_use" && b.name === "log_unanswered_question"
    );

    const unknowns = unknownQuestions.length ? unknownQuestions : undefined;

    if (escalateUse && escalateUse.type === "tool_use") {
      const input = escalateUse.input as { reason: string; summary: string };
      return { text, escalate: input, unknownQuestions: unknowns };
    }

    if (logUses.length) {
      for (const u of logUses) {
        if (u.type === "tool_use") {
          const q = (u.input as { question: string }).question;
          if (q) unknownQuestions.push(q);
        }
      }
      // מאכילים tool_result וממשיכים, כדי שהמודל ייצר תשובה ללקוח
      messages.push({ role: "assistant", content: response.content });
      messages.push({
        role: "user",
        content: logUses.map((u) => ({
          type: "tool_result" as const,
          tool_use_id: (u as Anthropic.ToolUseBlock).id,
          content: "נרשם לצוות.",
        })),
      });
      continue;
    }

    return { text, unknownQuestions: unknowns };
  }

  return {
    text: null,
    unknownQuestions: unknownQuestions.length ? unknownQuestions : undefined,
  };
}
