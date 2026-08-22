/**
 * הלקוח של Claude — זה ה"מוח" של הבוט.
 *
 * מקבל היסטוריית שיחה, מצרף את ה-System Prompt שנבנה מהקונפיג, ומחזיר תשובה.
 * זהה לחלוטין לכל הערוצים (וואטסאפ/מסנג'ר/אינסטגרם/Playground).
 */

import Anthropic from "@anthropic-ai/sdk";
import { loadBusinessConfig } from "./business-config-store";
import { loadMedia } from "./media-store";
import { buildSystemPrompt } from "./system-prompt";
import { isGateConfigured } from "./palgate";
import { memoryContextBlock } from "./customer-memory";
import type { ConversationMessage } from "./channels/types";

// מודל ברירת מחדל: Sonnet 4.6 - עברית נקייה ומדויקת, מתאים לבוט שמדבר עם לקוחות.
// העלות האמיתית נמוכה הודות ל-prompt caching. אפשר לעקוף דרך CHATBOT_MODEL
// (למשל "claude-haiku-4-5-20251001" לזול יותר, אם מוכנים לגליצ'ים זעירים בעברית).
const MODEL = process.env.CHATBOT_MODEL ?? "claude-sonnet-4-6";
// מספיק גם לתשובה ארוכה (רשימת מנות/שעות) בלי להיקטע באמצע משפט
const MAX_TOKENS = 2048;

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
    // ⚠️ הזמנים חייבים להיות תואמים ל-maxDuration של ה-routes (90 שניות).
    // timeout*(maxRetries+1) חייב להישאר מתחת ל-maxDuration, אחרת בקשה איטית
    // (למשל "תן לי את כל התפריט") נקטעת ומנסה שוב עד שהפלטפורמה הורגת אותה -> 504.
    client = new Anthropic({ apiKey, maxRetries: 1, timeout: 35_000 });
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
  /** כרטיס הזיכרון של הלקוח (משיחות קודמות) - מוזרק כהקשר לא-ממוטמן */
  customerMemory?: string;
  /** הערוץ שבו מתנהלת השיחה (whatsapp/messenger/instagram/playground) -
      שהבוט יידע שהוא-עצמו עונה שם ולא "יפנה" לקוחות לערוץ שהם כבר בו */
  channel?: string;
  /** הזמנות פעילות (ממתינות/מאושרות עתידיות) של הלקוח - שהבוט יזכור התחייבויות
      גם אחרי ימים, גם בשיחה חדשה, וגם כשההיסטוריה נחתכה */
  activeReservations?: string;
}

export interface GenerateResult {
  /** טקסט התשובה (null אם המודל בחר רק להסלים) */
  text: string | null;
  /** אם המודל החליט להעביר לנציג אנושי */
  escalate?: { reason: string; summary: string; urgent?: boolean };
  /** שאלות עסקיות שהבוט לא ענה עליהן במלואן (לתיעוד באדמין) */
  gapQuestions?: string[];
  /** מזהי מדיה שהמודל בחר לשלוח (ייפתרו לכתובות ויישלחו בערוץ) */
  mediaIds?: string[];
  /** המודל ביקש לפתוח את שער החניה (הביצוע והאכיפה בשכבת השירות) */
  openGateRequested?: boolean;
  /** בקשת הזמנת מקום שהמודל אסף (תיפתח ככרטיס בפאנל) */
  reservation?: {
    people: number;
    date_text: string;
    date?: string;
    time: string;
    name: string;
    phone: string;
    notes?: string;
  };
  /** שימוש בטוקנים בפועל (למד העלות) */
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  };
  /** המודל ששימש בפועל (למחירון) */
  model?: string;
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
      urgent: {
        type: "boolean",
        description:
          "true אם הלקוח כועס, מתוסכל, או שמדובר בעניין דחוף/רגיש שדורש טיפול מהיר. אחרת false.",
      },
    },
    required: ["reason", "summary"],
  },
};

// כלי לשליחת מדיה (תמונה/סרטון) ללקוח, לצד התשובה.
const SEND_MEDIA_TOOL: Anthropic.Tool = {
  name: "send_media",
  description:
    "שלח תמונה או סרטון ללקוח, בנוסף לתשובת הטקסט. השתמש בזה רק כשאחד מפריטי המדיה שברשותך באמת רלוונטי ועוזר לשאלה (למשל סרטון חניה כששואלים איך מגיעים, או תמונת מנה כששואלים עליה). אל תשלח מדיה לא רלוונטית.",
  input_schema: {
    type: "object",
    properties: {
      mediaId: {
        type: "string",
        description: "ה-id של פריט המדיה לשליחה (מתוך רשימת המדיה שב-System Prompt).",
      },
    },
    required: ["mediaId"],
  },
};

// כלי בקשת הזמנת מקום: המודל אוסף את כל הפרטים בשיחה ואז קורא לכלי.
const RESERVATION_TOOL: Anthropic.Tool = {
  name: "request_reservation",
  description:
    "פתח בקשת הזמנת מקום עבור הלקוח. קרא לכלי הזה רק אחרי שאספת את כל הפרטים: כמה אנשים, לאיזה יום, לאיזו שעה, על שם מי, ומספר טלפון - ואחרי שהלקוח אישר את הסיכום. הבקשה עוברת לצוות לאישור; אתה לא מבטיח מקום.",
  input_schema: {
    type: "object",
    properties: {
      people: { type: "number", description: "מספר הסועדים" },
      date_text: {
        type: "string",
        description: "היום המבוקש במילים של הלקוח, למשל 'מחר' או 'יום שישי'",
      },
      date: {
        type: "string",
        description: "אותו יום בפורמט YYYY-MM-DD לפי התאריך הנוכחי שסופק לך (אם אינך בטוח - השמט)",
      },
      time: { type: "string", description: "שעה בפורמט HH:MM" },
      name: { type: "string", description: "שם מלא להזמנה" },
      phone: { type: "string", description: "מספר טלפון של הלקוח" },
      notes: {
        type: "string",
        description: "בקשות מיוחדות אם יש (יום הולדת, ישיבה בחוץ, עגלת תינוק...)",
      },
    },
    required: ["people", "date_text", "time", "name", "phone"],
  },
};

// כלי פתיחת שער החניה: המודל קורא לו כשהלקוח מבקש לפתוח את השער.
// הפתיחה בפועל (כולל בדיקת שעות פעילות ומגבלות) נעשית בקוד, בשכבת השירות.
const OPEN_GATE_TOOL: Anthropic.Tool = {
  name: "open_parking_gate",
  description:
    "פתח את שער החניה של המסעדה עבור הלקוח. קרא לכלי הזה בכל פעם שהלקוח מבקש במפורש לפתוח את השער (הוא נמצא עכשיו בכניסה לחניה). אל תקרא לו על שאלות כלליות על חניה (איפה חונים, כמה עולה) - לאלה יש מידע רגיל. חשוב: אל תחליט בעצמך אם אנחנו פתוחים או סגורים - המערכת בודקת את שעות הפעילות אוטומטית ותפתח רק אם מותר. פשוט קרא לכלי כשמבקשים, וכתוב אישור קצר וטבעי; אם המערכת לא תוכל לפתוח (מחוץ לשעות) היא תודיע לך.",
  input_schema: {
    type: "object",
    properties: {},
  },
};

// כלי דיווח שקט: המודל מסמן כל שאלה עסקית שלא ענה עליה במלואה, במקביל לתשובה.
const REPORT_GAP_TOOL: Anthropic.Tool = {
  name: "report_knowledge_gap",
  description:
    "סמן ברקע (בשקט) כל שאלה שקשורה לעסק שלא יכולת לענות עליה במלואה מהמידע שברשותך - אפילו הקטנה והשולית ביותר (איפה השירותים, האם אפשר להפריד/להוסיף/להוריד רכיב במנה, כמה עובדים יש, כמה מקומות ישיבה, וכו'). חשוב: זה לא מחליף את התשובה ללקוח - תמיד כתוב גם תשובה רגילה וטבעית כטקסט. הכלי רק מתעד לצוות כדי שיוכלו לענות בעתיד. אל תשתמש בו לשאלות שלא קשורות לעסק, ולא לשאלות שענית עליהן במלואן מהמידע שיש לך.",
  input_schema: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description:
          "נסח מחדש את השאלה הבודדת שלא ידעת לענות עליה, כמשפט קצר וברור (עד ~10 מילים). אל תעתיק את כל הודעת הלקוח. אם הלקוח שאל כמה דברים שלא ידעת - קרא לכלי בנפרד לכל שאלה, עם ניסוח תמציתי משלה.",
      },
    },
    required: ["question"],
  },
};

/**
 * מקבל את היסטוריית השיחה ומחזיר את תשובת הבוט, החלטה להסלים, ושאלות שלא נענו.
 */
export async function generateReply(
  history: ConversationMessage[],
  options: GenerateOptions = {}
): Promise<GenerateResult> {
  const anthropic = getClient();

  // המידע העסקי + ספריית המדיה נטענים דינמית (ניתנים לעריכה מהפאנל).
  const [businessConfig, media] = await Promise.all([loadBusinessConfig(), loadMedia()]);
  const systemPrompt = buildSystemPrompt(businessConfig, media);

  const systemBlocks: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text: systemPrompt,
      // מטמון לשעה (ולא 5 דקות): ה-System Prompt זהה לכל הלקוחות, וכל שימוש
      // מאריך את חייו - כך משלמים כתיבה יקרה בערך פעם ביום במקום בכל הודעה.
      // ⚠️ ההיסטוריה (נקודת המטמון השנייה, למטה) נשארת ב-5 דקות בכוונה:
      // היא נכתבת מחדש בכל תור ורלוונטית לשיחה אחת, אז מטמון שעתי היה מייקר.
      cache_control: { type: "ephemeral", ttl: "1h" },
    },
  ];
  if (options.learnedFaqs && options.learnedFaqs.length) {
    const faqText = options.learnedFaqs
      .map((f) => `  שאלה: ${f.question}\n  תשובה: ${f.answer}`)
      .join("\n\n");
    systemBlocks.push({
      type: "text",
      text: `# ידע נוסף שהצוות הוסיף (השתמש בו כמו בשאר המידע על העסק)\n${faqText}`,
      // נקודת מטמון שנייה (נוספה 22.8): הבלוק הזה זהה לכל הלקוחות ומשתנה רק
      // כשהצוות עונה על שאלה חדשה - אבל עד היום נשלח כקלט מלא בכל הודעה
      // (~2,450 טוקנים = $0.007 להודעה, כ-13% מהעלות היומית). כמטמון הוא עולה
      // עשירית מזה. הוא יושב אחרי ה-System Prompt כדי שעדכון ידע לא יפסול גם אותו.
      cache_control: { type: "ephemeral", ttl: "1h" },
    });
  }
  // זיכרון הלקוח (אם קיים) - בלוק לא-ממוטמן, כי הוא שונה מלקוח ללקוח
  const memoryBlock = memoryContextBlock(options.customerMemory);
  if (memoryBlock) {
    systemBlocks.push({ type: "text", text: memoryBlock });
  }
  systemBlocks.push({
    type: "text",
    text: `המועד הנוכחי בישראל (שעון מקומי): ${israelDateTime()}.`,
  });
  if (options.activeReservations) {
    systemBlocks.push({
      type: "text",
      text: `ללקוח הזה יש הזמנות פעילות אצלנו: ${options.activeReservations}. אם הוא מזכיר את ההזמנה, שואל עליה או מבקש שינוי - התייחס אליה ישירות ובדיוק (אל תשאל "איזו הזמנה?").`,
    });
  }
  if (options.channel) {
    const chName =
      { whatsapp: "וואטסאפ", messenger: "מסנג'ר (פייסבוק)", instagram: "אינסטגרם", playground: "צ'אט הבדיקה של הפאנל" }[
        options.channel
      ] ?? options.channel;
    systemBlocks.push({
      type: "text",
      text: `השיחה הזאת מתנהלת ב${chName} - אתה עונה מהחשבון של המסעדה בערוץ הזה עצמו. לעולם אל תפנה את הלקוח "לפנות אלינו" בערוץ שהוא כבר נמצא בו.`,
    });
  }
  if (options.firstTurn) {
    systemBlocks.push({
      type: "text",
      text: `הערה: זו ההודעה הראשונה בשיחה. הגב בחום ובטבעיות, כמו מארח אמיתי. שזור במשפט קצר וזורם את העובדה שאתה העוזר הדיגיטלי (AI) של "${businessConfig.name}" ושאפשר לבקש נציג אנושי בכל שלב, אבל בעדינות ובדרך אגב, לא ככותרת פותחת ולא כתבנית קבועה, וכל פעם קצת אחרת. אם הלקוח כבר שאל שאלה, ענה עליה ישר ואל תשאל "איך אפשר לעזור". אם הוא רק בירך, החזר ברכה חמה וקצרה והזמן אותו לשאול. קצר, אנושי, בלי משפטים שיווקיים.`,
    });
  }

  const reqMessages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // ⚠️ אין כאן נקודת מטמון שנייה - בכוונה.
  // מטמון עובד לפי התאמת "קידומת": כל שינוי בבתים שלפני הנקודה פוסל אותה.
  // בלוק השעה הנוכחית (שמשתנה בכל בקשה) יושב לפני ההודעות, ולכן נקודת מטמון
  // על ההודעה האחרונה לעולם לא הייתה נמצאת - ובמקום לחסוך, היא גרמה לכתיבה
  // מחדש של כל ה-prompt בכל בקשה (מדדנו: ~5,000 טוקני כתיבה להודעה).
  // ההיסטוריה קצרה ממילא, אז שליחתה כקלט רגיל זולה בהרבה.
  // נקודת המטמון היחידה היא ה-System Prompt (למעלה) - יציב וזהה לכל הלקוחות.

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemBlocks,
    // כלי השער נכלל רק כשחיבור PalGate מוגדר (משתני סביבה) - אחרת המודל לא מכיר אותו
    tools: isGateConfigured()
      ? [ESCALATE_TOOL, REPORT_GAP_TOOL, SEND_MEDIA_TOOL, RESERVATION_TOOL, OPEN_GATE_TOOL]
      : [ESCALATE_TOOL, REPORT_GAP_TOOL, SEND_MEDIA_TOOL, RESERVATION_TOOL],
    messages: reqMessages,
  });

  if (process.env.NODE_ENV !== "production") {
    const u = response.usage;
    console.log(
      `[cost] in=${u.input_tokens} cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0} out=${u.output_tokens}`
    );
  }

  const textBlock = response.content.find((b) => b.type === "text");
  let text = textBlock && textBlock.type === "text" ? textBlock.text : null;

  // מזהי מדיה שהמודל בחר לשלוח
  const mediaIds = response.content
    .filter((b) => b.type === "tool_use" && b.name === "send_media")
    .map((b) => ((b as Anthropic.ToolUseBlock).input as { mediaId: string }).mediaId)
    .filter((x): x is string => !!x);

  const openGateRequested = response.content.some(
    (b) => b.type === "tool_use" && b.name === "open_parking_gate"
  );

  const reservationUse = response.content.find(
    (b) => b.type === "tool_use" && b.name === "request_reservation"
  );
  const reservation =
    reservationUse && reservationUse.type === "tool_use"
      ? (reservationUse.input as GenerateResult["reservation"])
      : undefined;

  const escalateUse = response.content.find(
    (b) => b.type === "tool_use" && b.name === "escalate_to_human"
  );
  // נתוני השימוש בפועל - מוחזרים לכל מסלול כדי שמד העלות יהיה מדויק
  const usage = response.usage;

  if (escalateUse && escalateUse.type === "tool_use") {
    return {
      text,
      escalate: escalateUse.input as { reason: string; summary: string; urgent?: boolean },
      mediaIds: mediaIds.length ? mediaIds : undefined,
      openGateRequested: openGateRequested || undefined,
      reservation,
      usage,
      model: MODEL,
    };
  }

  // קוצרים את כל דיווחי פערי הידע
  const gapQuestions = response.content
    .filter((b) => b.type === "tool_use" && b.name === "report_knowledge_gap")
    .map((b) => ((b as Anthropic.ToolUseBlock).input as { question: string }).question)
    .filter((q): q is string => !!q);

  // הגנה: אם המודל סימן פער אבל לא כתב תשובה ללקוח, מבקשים תשובה בקריאה אחת בלי כלים
  if (!text || !text.trim()) {
    const retry = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemBlocks,
      messages: reqMessages,
    });
    const rt = retry.content.find((b) => b.type === "text");
    text = rt && rt.type === "text" ? rt.text : null;
  }

  return {
    text,
    gapQuestions: gapQuestions.length ? gapQuestions : undefined,
    mediaIds: mediaIds.length ? mediaIds : undefined,
    openGateRequested: openGateRequested || undefined,
    reservation,
    usage,
    model: MODEL,
  };
}
