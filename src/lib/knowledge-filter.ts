/**
 * "המסנן החכם" של מסך הידע.
 *
 * כשהבוט נתקל בשאלה שהוא לא ידע לענות עליה, במקום להכניס אותה לרשימה כמו
 * שהיא (טקסט גולמי, כפילויות, זבל) - היא עוברת עיבוד קצר במודל שעושה 3 דברים:
 *  1. ניסוח מקצועי ("קוד קופון משהו? תבדוק שוב" -> "האם יש קודי קופון?")
 *  2. זיהוי כפילות סמנטית מול השאלות הקיימות -> מונה +1 במקום שורה חדשה
 *  3. סינון: בקשות שירות/קשקוש שאינם שאלת ידע עסקית - לא נכנסות בכלל
 *
 * בכשל של המודל - נופלים להתנהגות הישנה (רישום הטקסט הגולמי), כדי שאף
 * שאלה לא תלך לאיבוד.
 */

import Anthropic from "@anthropic-ai/sdk";
import { getRepo } from "./db";
import { classifyTopic } from "./insights";
import { recordLlmUsage } from "./usage";
import { sendKnowledgeGapEmail } from "./alerts";
import type { LearnedQA, QAAsker } from "./db/types";

const MODEL = process.env.CHATBOT_MODEL ?? "claude-sonnet-4-6";

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  if (!client) client = new Anthropic({ apiKey, maxRetries: 1, timeout: 15_000 });
  return client;
}

export interface FilterVerdict {
  action: "new" | "duplicate" | "discard";
  /** לניסוח new: השאלה המנוסחת */
  question?: string;
  /** לכפילות: מזהה השאלה הקיימת */
  duplicateId?: string;
  /** האם הכפילות היא מול שאלה שכבר נענתה */
  duplicateAnswered?: boolean;
}

/**
 * סגנון תשובת ידע: הצוות עונה בשפה חופשית ("250 בחוץ 100 בפנים"), והמערכת
 * מנסחת מזה תשובה מקצועית ומסודרת בטון של הבוט - בלי לשנות אף עובדה.
 * בכשל: מחזיר את הטקסט המקורי (עדיף תשובה גולמית מאשר לאבד אותה).
 */
export async function polishAnswer(question: string, rawAnswer: string): Promise<string> {
  const raw = rawAnswer.trim();
  const anthropic = getClient();
  if (!anthropic || raw.length < 2) return raw;
  try {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 220,
      system:
        "אתה מנסח תשובות למאגר הידע של בוט שירות של בית קפה. תקבל שאלת לקוח ותשובה שכתב איש צוות בשפה חופשית ומקוצרת. " +
        "נסח את התשובה מחדש בעברית טבעית, ברורה ומקצועית, בטון חם וענייני, במשפט אחד עד שלושה. אל תצטט מילה במילה - סגנן. " +
        "כללי ברזל: כל העובדות, המספרים, השעות והמחירים נשמרים בדיוק כפי שנכתבו - אסור להוסיף מידע, להשמיט, לנחש או להחליף בין ערכים. " +
        "בלי פתיחים ('תשובה:', 'כמובן!'), בלי אימוג'י, בלי קישורים שלא הופיעו בתשובת הצוות. " +
        "אם התשובה כבר מנוסחת היטב - החזר אותה כמעט כמו שהיא. החזר את הנוסח בלבד, בלי הסברים.",
      messages: [
        { role: "user", content: `השאלה: ${question.slice(0, 200)}\nתשובת הצוות: ${raw.slice(0, 500)}` },
      ],
    });
    await recordLlmUsage(MODEL, res.usage, false);
    const text = res.content.find((b) => b.type === "text");
    const polished = text && text.type === "text" ? text.text.trim() : "";
    // הגנה: תוצאה ריקה או מנופחת -> נשארים עם המקור
    if (polished.length < 2 || polished.length > 600) return raw;
    return polished;
  } catch (err) {
    console.error("[knowledge-polish] ניסוח נכשל, נשמר המקור:", err);
    return raw;
  }
}

/**
 * מפעיל את המסנן על שאלה גולמית מול רשימת שאלות קיימות.
 * מוחזר verdict בלבד - הפעולה על ה-DB נעשית אצל הקורא.
 */
export async function evaluateGapQuestion(
  raw: string,
  existing: LearnedQA[]
): Promise<FilterVerdict> {
  const fallback: FilterVerdict = { action: "new", question: raw.slice(0, 140) };
  const anthropic = getClient();
  if (!anthropic) return fallback;

  // רשימה קומפקטית של השאלות הקיימות (החדשות ביותר, עד 60)
  const recent = existing.slice(0, 60);
  const listText = recent
    .map((q, i) => `${i + 1}. [${q.status === "answered" ? "נענתה" : "פתוחה"}] ${q.question}`)
    .join("\n");

  try {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 150,
      system:
        "אתה מסנן שאלות עבור מערכת ידע של בית קפה. תקבל הודעת לקוח שהבוט לא ידע לענות עליה, " +
        "ורשימת שאלות שכבר קיימות במערכת. החזר JSON בלבד (בלי הסברים, בלי גרשי קוד) באחת מהצורות:\n" +
        '{"action":"discard"} - אם זו לא שאלת ידע עסקית שאפשר ללמד עליה תשובה קבועה. למשל: בקשת פעולה אישית ("תסגור לי", "תבדוק שוב"), קשקוש, ברכה, תלונה, או בקשת שירות שדורשת נציג.\n' +
        '{"action":"duplicate","index":N} - אם השאלה זהה במהות לשאלה מספר N מהרשימה (גם אם מנוסחת אחרת).\n' +
        '{"action":"new","question":"..."} - אחרת. נסח את השאלה מחדש בעברית מקצועית, קצרה וכללית (עד 12 מילים), בגוף שאלה. למשל: "קוד קופון משהו? תבדוק שוב" -> "האם יש קודי קופון?". אם ההודעה מכילה כמה שאלות - בחר את המרכזית שלא נענתה.\n' +
        'חריג חשוב - שאלות אימות: אם ההודעה מתחילה ב"אימות:" או מתארת לקוח שמערער על מידע קיים (טוען ששעות/מחיר/פרט אחר שגויים), זו בקשת בדיקה לצוות: החזר תמיד {"action":"new"} עם ניסוח שמתחיל ב"אימות:" ומשמר את שני הצדדים (מה הלקוח טען ומה רשום) - גם אם קיימת שאלה דומה שכבר נענתה. לעולם אל תסמן שאלת אימות כ-discard או כ-duplicate של שאלה שנענתה.',
      messages: [
        {
          role: "user",
          content: `הודעת הלקוח:\n"""${raw.slice(0, 600)}"""\n\nשאלות קיימות:\n${listText || "(אין)"}`,
        },
      ],
    });
    await recordLlmUsage(MODEL, res.usage, false);

    const text = res.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return fallback;
    const cleaned = text.text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned) as {
      action?: string;
      index?: number;
      question?: string;
    };

    if (parsed.action === "discard") return { action: "discard" };
    if (parsed.action === "duplicate" && typeof parsed.index === "number") {
      const target = recent[parsed.index - 1];
      if (target) {
        return {
          action: "duplicate",
          duplicateId: target.id,
          duplicateAnswered: target.status === "answered",
        };
      }
      return fallback;
    }
    if (parsed.action === "new" && parsed.question?.trim()) {
      return { action: "new", question: parsed.question.trim().slice(0, 140) };
    }
    return fallback;
  } catch (err) {
    console.error("[knowledge-filter] נפילה לרישום גולמי:", err);
    return fallback;
  }
}

/**
 * הזרימה המלאה: מעריך את השאלה ופועל על ה-DB בהתאם.
 * - new -> נרשמת שאלה חדשה (מנוסחת) + התראת מייל
 * - duplicate של פתוחה -> מונה +1 ורישום השואל
 * - duplicate של שנענתה -> לא נרשם (הידע כבר קיים)
 * - discard -> לא נרשם
 */
export async function processGapQuestion(
  raw: string,
  asker: QAAsker
): Promise<void> {
  const q = raw.trim();
  if (q.length < 4) return;
  const repo = getRepo();
  const existing = await repo.listLearnedQA();

  // קיצור דרך זול: התאמה מילולית מדויקת לפני שמפעילים מודל
  const exact = existing.find(
    (e) => e.question.trim().toLowerCase() === q.toLowerCase()
  );
  if (exact) {
    if (exact.status === "open") await repo.recordLearnedQAAsk(exact.id, asker);
    return;
  }

  const verdict = await evaluateGapQuestion(q, existing);

  if (verdict.action === "discard") {
    console.log(`[knowledge] סונן (לא שאלת ידע): "${q.slice(0, 60)}"`);
    return;
  }
  if (verdict.action === "duplicate" && verdict.duplicateId) {
    if (!verdict.duplicateAnswered) {
      await repo.recordLearnedQAAsk(verdict.duplicateId, asker);
      console.log(`[knowledge] אוחדה עם שאלה קיימת: "${q.slice(0, 60)}"`);
    }
    return;
  }
  const question = verdict.question ?? q.slice(0, 140);
  await repo.addOpenQuestion({
    question,
    conversationId: asker.conversationId,
    askerName: asker.name,
    topic: classifyTopic(question),
  });
  sendKnowledgeGapEmail(question).catch(() => {});
}
