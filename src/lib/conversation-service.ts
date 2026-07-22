/**
 * שכבת השירות שמחברת הודעות נכנסות לשיחות מתמשכות.
 *
 * זה המקום המרכזי שבו: מזהים/יוצרים לקוח ושיחה, שומרים הודעות, מפעילים את
 * המוח, ושומרים את התשובה. משמש גם את ה-Playground וגם את כל הערוצים.
 * אם נציג אנושי השתלט על השיחה (status=human), הבוט שותק.
 */

import { randomUUID } from "crypto";
import { getRepo } from "./db";
import { generateReply } from "./claude";
import { loadBusinessConfig } from "./business-config-store";
import { loadMedia, isMediaRelevant } from "./media-store";
import { sendEscalationEmail } from "./alerts";
import { isOpenNow, israelDateISO } from "./business-hours";
import type { BusinessConfig } from "./business-config";
import type { Channel, ConversationMessage } from "./channels/types";

// ביטויים שמעידים שהבוט לא ידע לענות (פער ידע) -> נרשום את שאלת הלקוח
const GAP_PATTERNS = [
  "אין לי את",
  "אין לי מידע",
  "אין לי פרט",
  "אין לי כרגע",
  "אין לי גישה",
  "אין לי את הפרט",
  "אין לי את התאריך",
  "אין לי את כל הפרט",
  "לא מופיע אצלי",
  "לא נמצא אצלי",
  "לא מצאתי",
  "כדאי לברר",
  "שווה לברר",
  "לברר עם הצוות",
  "לברר ישירות",
  "לבדוק עם הצוות",
  "לבדוק מול הצוות",
  "הצוות ישמח לספר",
  "הצוות יוכל לעדכן",
];

function detectKnowledgeGap(reply: string): boolean {
  return GAP_PATTERNS.some((p) => reply.includes(p));
}

/** רושם שאלה פתוחה (עם מניעת כפילויות מול שאלות פתוחות ושנענו) */
async function logOpenQuestion(
  question: string,
  conversationId: string
): Promise<void> {
  const q = question.trim();
  if (q.length < 4) return;
  const repo = getRepo();
  const all = await repo.listLearnedQA();
  const key = q.toLowerCase();
  if (all.some((e) => e.question.trim().toLowerCase() === key)) return;
  await repo.addOpenQuestion({ question: q, conversationId });
}

/**
 * זיהוי שפת הלקוח מהודעותיו האחרונות, כדי שגם ההודעות הקבועות שלנו (העברה לנציג,
 * תקלה, הגבלת קצב) יהיו באותה שפה - ולא "יקפצו" לעברית באמצע שיחה באנגלית.
 * שמרני בכוונה: עוברים לאנגלית רק כשאין עברית בכלל ויש מספיק טקסט לטיני.
 */
function detectLang(texts: string[]): "he" | "en" {
  const joined = texts.join(" ");
  const hebrew = (joined.match(/[֐-׿]/g) || []).length;
  const latin = (joined.match(/[A-Za-z]/g) || []).length;
  return hebrew === 0 && latin >= 4 ? "en" : "he";
}

/** שפת הלקוח לפי שלוש הודעותיו האחרונות בהיסטוריה */
function langFromHistory(history: ConversationMessage[]): "he" | "en" {
  return detectLang(
    history.filter((m) => m.role === "user").slice(-3).map((m) => m.content)
  );
}

/** מנסח הודעת העברה לאדם, לפי שעות הפעילות ושפת הלקוח. ב-firstTurn שוזר גילוי AI. */
function buildHandoffMessage(
  firstTurn: boolean,
  config: BusinessConfig,
  lang: "he" | "en" = "he"
): string {
  const phone = config.contact.phone;
  if (lang === "en") {
    const phoneLine = phone ? ` You can also call us at ${phone}.` : "";
    const body = isOpenNow(config)
      ? `connecting you with a member of our team, and they'll get back to you right here shortly.${phoneLine}`
      : `passing your message on to our team. We're currently closed, so they'll get back to you during opening hours.${phoneLine}`;
    if (firstTurn) {
      return `I'm the digital assistant of ${config.name}, and I'm ${body}`;
    }
    return `Got it 🙋 I'm ${body}`;
  }
  const phoneLine = phone ? ` אפשר גם להתקשר ל-${phone}.` : "";
  const body = isOpenNow(config)
    ? `מעביר אותך לנציג אנושי מהצוות, והוא יחזור אליך כאן בהקדם.${phoneLine}`
    : `מעביר את פנייתך לצוות. אנחנו כרגע סגורים, אז הם יחזרו אליך בשעות הפעילות.${phoneLine}`;
  if (firstTurn) {
    return `אני העוזר הדיגיטלי של ${config.name}, ואני ${body}`;
  }
  return `הבנתי 🙋 אני ${body}`;
}

const HISTORY_LIMIT = 12;

// טיפול ברצף הודעות + הגבלת קצב
const DEBOUNCE_MS = 500; // המתנה קצרה לראות אם המשתמש שולח עוד הודעה (קצר = מענה מהיר יותר)
const RATE_PER_MIN = 15;
const RATE_PER_HOUR = 50;
// כל כמה זמן מותר לשלוח הודעת "קיבלתי הרבה הודעות" לאותה שיחה (כדי לא לספמם בחזרה)
const RATE_NOTICE_COOLDOWN_MS = 90_000;
const rateNoticeAt = new Map<string, number>();

// ----- תקרת שימוש יומית גלובלית: רשת ביטחון קשיחה מפני עלות בורחת -----
// גבוה בהרבה מנפח אמיתי של בית קפה, כך שנוגעים בזה רק בתקיפה/תקלה.
// כשעוברים אותה הבוט שותק וההודעות ממתינות לצוות בפאנל (כמו כפתור הכיבוי).
const DAILY_REPLY_CAP = Number(process.env.DAILY_REPLY_CAP ?? 500);
const usageKeyForToday = () => `usage_${israelDateISO()}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** האם הגיעה הודעת לקוח חדשה יותר (כדי לדעת אם הקריאה הזו "הוחלפה" ע"י חדשה) */
async function hasNewerUserMessage(
  conversationId: string,
  afterTs: number
): Promise<boolean> {
  const msgs = await getRepo().getMessages(conversationId);
  return msgs.some((m) => m.role === "user" && m.ts > afterTs);
}

/** ממזג הודעות רצופות מאותו תפקיד להודעה אחת (רצף הודעות לקוח = תור אחד) */
function mergeConsecutive(
  history: ConversationMessage[]
): ConversationMessage[] {
  const out: ConversationMessage[] = [];
  for (const m of history) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += "\n" + m.content;
    else out.push({ ...m });
  }
  // המודל מצפה שההיסטוריה תתחיל בהודעת לקוח
  while (out.length && out[0].role === "assistant") out.shift();
  return out;
}

export interface HandleInput {
  channel: Channel;
  /** מזהה ייחודי של המשתמש בתוך הערוץ (טלפון / PSID / clientId בדפדפן) */
  channelUserId: string;
  text: string;
  /** מזהה שיחה אם ידוע (כדי להמשיך שיחה קיימת) */
  conversationId?: string;
  customerName?: string;
  /** מזהה ההודעה המקורי בערוץ (mid) - לדה-דופ מפני webhook כפול/retry */
  messageId?: string;
  /** פונקציה לשליפת שם המשתמש מהערוץ (נקראת רק אם אין עדיין שם שמור) */
  resolveName?: () => Promise<string | undefined>;
  /** מטא-דאטה להודעה, למשל { transcribedFromVoice: true } */
  meta?: Record<string, unknown>;
}

export interface HandleResult {
  conversationId: string;
  /** התשובה של הבוט, או null אם נציג אנושי מטפל בשיחה */
  reply: string | null;
  status: "bot" | "human" | "closed";
  /** מדיה לשליחה (אם הבוט בחר לצרף תמונה/סרטון) */
  media?: { url: string; type: "image" | "video" }[];
}

// דה-דופ סינכרוני בזיכרון: חוסם עיבוד כפול של אותה הודעה (mid) באותו instance,
// גם במרוץ מקבילי - כי הבדיקה+ההוספה סינכרוניות (בלי await ביניהן). משלים את
// הדה-דופ במסד הנתונים (שמכסה מקרים בין-instance).
const recentMids = new Set<string>();
function alreadyHandled(mid?: string): boolean {
  if (!mid) return false;
  if (recentMids.has(mid)) return true;
  recentMids.add(mid);
  if (recentMids.size > 1000) recentMids.delete(recentMids.values().next().value as string);
  return false;
}

export async function handleIncomingMessage(
  input: HandleInput
): Promise<HandleResult> {
  // חסימת כפילות מיידית (webhook כפול / retry של מטא) - לפני כל פעולה אסינכרונית
  if (alreadyHandled(input.messageId)) {
    return { conversationId: input.conversationId ?? "", reply: null, status: "bot" };
  }

  const repo = getRepo();
  const customerId = `${input.channel}:${input.channelUserId}`;

  // upsert הלקוח ואיתור השיחה אינם תלויים זה בזה (ה-customerId מחושב ישירות),
  // אז מריצים אותם במקביל כדי לחסוך סבב הלוך-ושוב למסד הנתונים (מענה מהיר יותר).
  // מציאת שיחה: לפי מזהה אם ניתן, אחרת לפי הלקוח (חשוב לרצף הודעות בלי מזהה,
  // למשל בוואטסאפ ששם המפתח הוא הלקוח). כך הודעות עוקבות מאותו אדם נכנסות לאותה שיחה.
  const [customer, foundConversation] = await Promise.all([
    repo.upsertCustomer({
      id: customerId,
      channel: input.channel,
      channelUserId: input.channelUserId,
      name: input.customerName,
    }),
    input.conversationId
      ? repo.getConversation(input.conversationId)
      : repo
          .listConversations()
          .then(
            (all) =>
              all.find(
                (c) => c.customerId === customerId && c.status !== "closed"
              ) ?? null
          ),
  ]);

  let conversation = foundConversation;
  if (!conversation || conversation.status === "closed") {
    conversation = await repo.createConversation({
      id: input.conversationId ?? randomUUID(), // מכבד מזהה שנוצר אצל הלקוח (Playground)
      channel: input.channel,
      customerId,
      status: "bot",
    });
  }

  // דה-דופ: אם כבר עיבדנו הודעה עם אותו mid (webhook כפול / retry של מטא), דלג
  if (input.messageId) {
    const existing = await repo.getMessages(conversation.id);
    if (existing.some((m) => m.meta?.mid === input.messageId)) {
      return { conversationId: conversation.id, reply: null, status: conversation.status };
    }
  }

  // שמירת הודעת המשתמש (כולל ה-mid לדה-דופ עתידי)
  const myTs = Date.now();
  await repo.addMessage({
    conversationId: conversation.id,
    role: "user",
    content: input.text,
    ts: myTs,
    meta: input.messageId ? { ...(input.meta || {}), mid: input.messageId } : input.meta,
  });

  // אם נציג אנושי כבר מטפל בשיחה, הבוט לא עונה
  if (conversation.status === "human") {
    return { conversationId: conversation.id, reply: null, status: "human" };
  }

  // הבוט מושהה לשיחה הזו בלבד (נציג בחר לטפל ידנית) - הבוט שותק, ההודעה ממתינה בפאנל
  if (conversation.botPaused) {
    return { conversationId: conversation.id, reply: null, status: conversation.status };
  }

  // כפתור כיבוי גלובלי + תקרת שימוש יומית - נקראים במקביל (בלי להוסיף זמן תגובה)
  const usageKey = usageKeyForToday();
  const [botEnabledRaw, usageRaw] = await Promise.all([
    repo.getSetting("bot_enabled"),
    repo.getSetting(usageKey),
  ]);
  if (botEnabledRaw === "false") {
    return { conversationId: conversation.id, reply: null, status: conversation.status };
  }
  const usedToday = Number(usageRaw ?? 0);
  if (usedToday >= DAILY_REPLY_CAP) {
    // עברנו את התקרה היומית - הבוט שותק וההודעה ממתינה לצוות בפאנל.
    console.error(
      `[DAILY_CAP] נעצר: ${usedToday}/${DAILY_REPLY_CAP} תשובות היום. ההודעות ממתינות לצוות.`
    );
    return { conversationId: conversation.id, reply: null, status: conversation.status };
  }

  // הודעה קולית שלא הצלחנו לתמלל - מבקשים מהלקוח להקליד, בלי לערב את המודל.
  // מגיע לכאן רק אם הבוט פעיל ואין נציג אנושי (כללי השתיקה למעלה כבר חלים).
  if (input.meta?.voiceTranscriptionFailed) {
    // דו-לשוני בכוונה: כשהתמלול נכשל אין לנו דרך לדעת באיזו שפה הלקוח דיבר.
    const reply =
      "קיבלתי הודעה קולית אבל לא הצלחתי להבין אותה 🙏 אפשר לכתוב לי בכמה מילים?\n" +
      "(I couldn't make out the voice message - could you type it instead?)";
    await repo.addMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: reply,
      ts: Date.now(),
    });
    return { conversationId: conversation.id, reply, status: "bot" };
  }

  // ----- הגבלת קצב (rate limit): הגנה מפני הצפת הודעות -----
  {
    const recent = await repo.getMessages(conversation.id);
    const now = Date.now();
    const perMin = recent.filter((m) => m.role === "user" && m.ts > now - 60_000).length;
    const perHour = recent.filter((m) => m.role === "user" && m.ts > now - 3_600_000).length;
    if (perMin > RATE_PER_MIN || perHour > RATE_PER_HOUR) {
      console.log(`[RATE_LIMIT] conv=${conversation.id} perMin=${perMin} perHour=${perHour}`);
      // במקום שתיקה מוחלטת - שולחים הודעה ידידותית אחת לכל "התקף" (לא בכל הודעה),
      // כדי שהלקוח יבין למה הבוט שקט ולא יחשוב שמשהו תקול.
      const last = rateNoticeAt.get(conversation.id) ?? 0;
      if (now - last > RATE_NOTICE_COOLDOWN_MS) {
        rateNoticeAt.set(conversation.id, now);
        if (rateNoticeAt.size > 1000) rateNoticeAt.delete(rateNoticeAt.keys().next().value as string);
        const phone = (await loadBusinessConfig()).contact.phone;
        const rlLang = detectLang(
          recent.filter((m) => m.role === "user").slice(-3).map((m) => m.content)
        );
        const notice =
          rlLang === "en"
            ? `I got a few messages in a row 🙂 I'm answering them one by one, so give me a moment and I'll get back to you.${phone ? ` If it's urgent, you can call our team at ${phone}.` : ""}`
            : `קיבלתי כמה הודעות ברצף 🙂 אני עונה אחת-אחת, אז שנייה של סבלנות ואני אחזור אליך.${phone ? ` אם זה דחוף אפשר להתקשר לצוות ב-${phone}.` : ""}`;
        await repo.addMessage({
          conversationId: conversation.id,
          role: "assistant",
          content: notice,
          ts: Date.now(),
          meta: { rateLimitNotice: true },
        });
        return { conversationId: conversation.id, reply: notice, status: conversation.status };
      }
      return { conversationId: conversation.id, reply: null, status: conversation.status };
    }
  }

  // ----- טיפול ברצף הודעות: דבאונס + "ההודעה האחרונה מנצחת" -----
  // מחכים רגע קצר; אם בינתיים הגיעה הודעה חדשה יותר, הקריאה הזו פורשת
  // (הקריאה החדשה תטפל בכל ההודעות יחד, ותחזיר תשובה אחת קוהרנטית).
  await sleep(DEBOUNCE_MS);

  // קריאה אחת מקבילה לכל מה שצריך אחרי הדבאונס (פחות הלוך-ושוב ל-DB = מענה מהיר יותר)
  const [stored, answeredQA] = await Promise.all([
    repo.getMessages(conversation.id),
    repo.listLearnedQA("answered"),
  ]);

  // אם בינתיים הגיעה הודעה חדשה יותר, פורשים (הקריאה החדשה תטפל בהכל יחד)
  if (stored.some((m) => m.role === "user" && m.ts > myTs)) {
    return { conversationId: conversation.id, reply: null, status: conversation.status };
  }

  const isFirstTurn = !conversation.disclosedAi;

  // בניית היסטוריה (ממוזגת - רצף הודעות לקוח נחשב כתור אחד).
  // תשובת נציג אנושי (agent) נחשבת כצד ה-assistant של השיחה, כדי שהבוט יראה
  // ששאלה שהנציג כבר ענה עליה טופלה - ולא יחזור עליה ולא ימזג שאלות שכבר נענו.
  const history = mergeConsecutive(
    stored
      .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "agent")
      .slice(-HISTORY_LIMIT)
      .map((m) => ({
        role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
        content: m.content,
      }))
  );

  // ידע נלמד: שאלות שהצוות ענה עליהן מוזרקות לבוט
  const learnedFaqs = answeredQA
    .filter((q) => q.answer)
    .map((q) => ({ question: q.question, answer: q.answer as string }));

  // שליפת שם המשתמש מהערוץ (רק אם אין עדיין שם שמור) - רץ במקביל לקריאת המודל
  // כדי לא להוסיף זמן תגובה, ונשמר ללקוח כדי שיופיע בפאנל.
  const namePromise =
    !customer.name && input.resolveName
      ? input
          .resolveName()
          .then((name) =>
            name
              ? repo.upsertCustomer({
                  id: customerId,
                  channel: input.channel,
                  channelUserId: input.channelUserId,
                  name,
                })
              : undefined
          )
          .catch(() => undefined)
      : Promise.resolve(undefined);

  let result;
  try {
    result = await generateReply(history, {
      firstTurn: isFirstTurn,
      learnedFaqs,
      customerMemory: customer.memory,
    });
  } catch (err) {
    // תקלה רגעית במוח (API נפל/timeout) - הלקוח לעולם לא נשאר בלי מענה.
    console.error("[conversation-service] generateReply נכשל:", err);
    await namePromise.catch(() => undefined);
    // אם בינתיים הגיעה הודעה חדשה יותר, נטוש (הקריאה החדשה תטפל)
    if (await hasNewerUserMessage(conversation.id, myTs)) {
      return { conversationId: conversation.id, reply: null, status: conversation.status };
    }
    const cfg = await loadBusinessConfig();
    const phone = cfg.contact.phone;
    const fallback =
      langFromHistory(history) === "en"
        ? `Sorry, I'm having a small technical issue right now 🙏 Could you try again in a moment?${phone ? ` If it's urgent, you can call our team at ${phone}.` : ""}`
        : `סליחה, יש לי תקלה קטנה כרגע 🙏 אפשר לנסות שוב עוד רגע?${phone ? ` ואם זה דחוף, אפשר להתקשר לצוות ב-${phone}.` : ""}`;
    await repo.addMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: fallback,
      ts: Date.now(),
      meta: { fallback: true },
    });
    return { conversationId: conversation.id, reply: fallback, status: "bot" };
  }
  await namePromise;

  // ספירת השימוש היומי (רשת הביטחון לעלות). ספירה מקורבת - מרוץ בין הודעות
  // מקבילות עלול "לאבד" ספירה בודדת, וזה מקובל עבור תקרת בטיחות.
  repo.setSetting(usageKey, String(usedToday + 1)).catch(() => undefined);

  // בדיקה סופית: אם בזמן שהמודל ניסח, הגיעה הודעה חדשה - זורקים את התשובה
  // (הקריאה החדשה תייצר תשובה מעודכנת). מונע תשובה כפולה/לא מעודכנת.
  if (await hasNewerUserMessage(conversation.id, myTs)) {
    return { conversationId: conversation.id, reply: null, status: conversation.status };
  }

  // ----- המודל החליט להעביר לנציג אנושי -----
  if (result.escalate) {
    await repo.updateConversation(conversation.id, {
      status: "human",
      escalated: true,
      escalationReason: result.escalate.reason,
      escalationSummary: result.escalate.summary,
      meta: result.escalate.urgent ? { urgent: true } : undefined,
    });
    // התראת אימייל לצוות (אם מוגדר RESEND_API_KEY) - לא חוסם
    sendEscalationEmail({
      customerName: customer.name,
      channel: input.channel,
      reason: result.escalate.reason,
      summary: result.escalate.summary,
      urgent: result.escalate.urgent,
    }).catch(() => {});
    await repo.addMessage({
      conversationId: conversation.id,
      role: "system",
      content: `הוסלם לנציג: ${result.escalate.reason}\nסיכום: ${result.escalate.summary}`,
      ts: Date.now(),
      meta: { escalation: true, summary: result.escalate.summary },
    });

    const handoff = buildHandoffMessage(
      isFirstTurn,
      await loadBusinessConfig(),
      langFromHistory(history)
    );
    if (isFirstTurn) {
      await repo.updateConversation(conversation.id, { disclosedAi: true });
    }
    await repo.addMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: handoff,
      ts: Date.now(),
      meta: { escalation: true },
    });
    // התראה לצוות (כרגע ללוג; בהמשך אימייל/וואטסאפ/דחיפה)
    console.log(
      `[ESCALATION] conv=${conversation.id} customer=${customerId} reason=${result.escalate.reason}`
    );
    return { conversationId: conversation.id, reply: handoff, status: "human" };
  }

  // ----- תשובה רגילה -----
  // בהודעה ראשונה עם שאלה, המודל כבר שזר את גילוי ה-AI בתוך התשובה (ראה claude.ts),
  // אז לא מדביקים משפט קבוע. (פתיחה של "רק ברכה" טופלה למעלה במסלול נפרד.)
  let reply = (result.text ?? "").trim();
  if (!reply) {
    reply =
      langFromHistory(history) === "en"
        ? "Sorry, I didn't quite catch that. Could you try again? 🙂"
        : "סליחה, לא הבנתי. אפשר לנסות שוב? 🙂";
  }
  if (isFirstTurn) {
    await repo.updateConversation(conversation.id, { disclosedAi: true });
  }

  // תיעוד פערי ידע: עדיפות לשאלות שהמודל סימן במפורש (report_knowledge_gap),
  // ובגיבוי - זיהוי דטרמיניסטי לפי ניסוח התשובה. כך נתפסת כל שאלה שלא נענתה.
  if (result.gapQuestions?.length) {
    for (const q of result.gapQuestions) {
      await logOpenQuestion(q, conversation.id);
    }
  } else if (detectKnowledgeGap(reply) && input.text.length <= 140) {
    // גיבוי היוריסטי - רק להודעה קצרה וממוקדת. בהודעה ארוכה/מרובת-שאלות אסור
    // לזרוק את כל הטקסט ל"ידע"; שם מסתמכים על חילוץ השאלות ע"י המודל (report_knowledge_gap).
    await logOpenQuestion(input.text, conversation.id);
  }

  // פתרון מזהי המדיה שהבוט בחר לשלוח -> כתובות בפועל.
  // בלם רלוונטיות: שולחים פריט רק אם הוא נוגע לנושא של ההקשר הקרוב בשיחה (לא רק
  // ההודעה האחרונה - כדי שזרם "רוצה סרטון? -> כן" יעבוד), ולא שולחים פעמיים את אותו
  // פריט באותה שיחה (מניעת כפילות, למשל כששואלים שאלת המשך).
  let media: { url: string; type: "image" | "video" }[] | undefined;
  let sentMediaIds: string[] | undefined;
  if (result.mediaIds?.length) {
    // הקשר רלוונטיות: כמה הודעות אחרונות (שני הצדדים) + התשובה הנוכחית.
    const contextText =
      history.slice(-5).map((m) => m.content).join(" ") + " " + reply;
    // מדיה שכבר נשלחה בשיחה הזו (לפי meta.sentMedia ששמרנו על הודעות קודמות)
    const alreadySent = new Set<string>(
      stored.flatMap((m) => (m.meta?.sentMedia as string[] | undefined) ?? [])
    );
    const chosen = (await loadMedia()).filter((m) => result.mediaIds!.includes(m.id));
    const toSend = chosen.filter(
      (m) => isMediaRelevant(m, contextText) && !alreadySent.has(m.id)
    );
    const dropped = chosen.filter((m) => !toSend.includes(m));
    if (dropped.length) {
      console.log(
        `[MEDIA] חסמתי מדיה: ${dropped.map((m) => m.label).join(", ")} (לא רלוונטי/כבר נשלח)`
      );
    }
    if (toSend.length) {
      media = toSend.map((m) => ({ url: m.url, type: m.type as "image" | "video" }));
      sentMediaIds = toSend.map((m) => m.id);
    }
  }

  await repo.addMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: reply,
    ts: Date.now(),
    meta: sentMediaIds ? { sentMedia: sentMediaIds } : undefined,
  });

  return { conversationId: conversation.id, reply, status: "bot", media };
}
