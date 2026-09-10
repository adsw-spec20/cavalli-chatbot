import { NextRequest, NextResponse } from "next/server";
import { getRepo } from "@/lib/db";
import { runTabitChat } from "@/lib/tabit-lab";
import { sendGreenMessage, greenApiConfigured } from "@/lib/green-api";
import { appendLabExchange, type LabToolEntry } from "@/lib/tabit-lab-store";

/**
 * בוט טאביט בקבוצת הוואטסAאפ (משטח B) - webhook נכנס מ-Green API.
 *
 * מגיב **רק** להודעות שמתייגות את הבוט בקבוצה (reactive-only), או להודעה ישירה
 * (1:1) שממילא מכוונת אליו. קריאה בלבד תמיד (forceReadOnly) - הבוט בקבוצה לעולם
 * לא יוצר/משנה/מבטל. מבודד מהצ'אט הציבורי (עובר דרך tabit-lab, לא הבוט של הלקוחות).
 *
 * הנתיב תחת /api/webhooks/ (ציבורי ב-middleware), ומאומת כאן בסוד ייעודי
 * (GREEN_API_WEBHOOK_SECRET) בכותרת Authorization: Bearer, או ?key=.
 *
 * הערה: המספר עוד לא מחובר - זו התשתית. חיבור ה-SIM והגדרת ה-instance בהמשך.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SEEN_KEY = "green_api_seen";
const SEEN_MAX = 200;

const BOT_NUMBER = (process.env.GREEN_API_BOT_NUMBER || "").replace(/\D/g, "");

const GROUP_SYSTEM =
  "אתה עונה בקבוצת וואטסאפ של צוות המסעדה. **גובר על כלל הפורמט של הטבלה:** אל תשתמש בטבלת markdown (היא נשברת בקבוצה) - הצג רשימות בשורות פשוטות, הזמנה בשורה, בפורמט: *שם* •• שעה •• X סועדים •• ש׳ שולחן •• טלפון •• פיקדון. תשובה קצרה וישירה, בלי הקדמות. ענה רק על מה שנשאלת.";

interface GreenMessageData {
  typeMessage?: string;
  textMessageData?: { textMessage?: string; mentionedJidList?: string[] };
  extendedTextMessageData?: { text?: string; mentionedJidList?: string[] };
}
interface GreenWebhook {
  typeWebhook?: string;
  idMessage?: string;
  senderData?: { chatId?: string; chatName?: string; sender?: string; senderName?: string };
  messageData?: GreenMessageData;
}

function authed(req: NextRequest): boolean {
  const secret = process.env.GREEN_API_WEBHOOK_SECRET;
  if (!secret) return false; // חייבים סוד מוגדר כדי שהוובהוק יפעל בכלל
  const auth = req.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const key = new URL(req.url).searchParams.get("key") || "";
  return bearer === secret || key === secret;
}

function extractText(md?: GreenMessageData): string {
  if (!md) return "";
  return (md.textMessageData?.textMessage || md.extendedTextMessageData?.text || "").trim();
}
function mentionedList(md?: GreenMessageData): string[] {
  return md?.extendedTextMessageData?.mentionedJidList || md?.textMessageData?.mentionedJidList || [];
}

/** dedup: Green API עלול לשלוח שוב את אותו webhook. מסמנים לפני העיבוד הארוך. */
async function alreadyHandled(idMessage: string): Promise<boolean> {
  if (!idMessage) return false;
  const repo = getRepo();
  const raw = await repo.getSetting(SEEN_KEY);
  let list: string[] = [];
  try {
    list = raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    list = [];
  }
  if (list.includes(idMessage)) return true;
  list.push(idMessage);
  if (list.length > SEEN_MAX) list = list.slice(-SEEN_MAX);
  await repo.setSetting(SEEN_KEY, JSON.stringify(list));
  return false;
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: GreenWebhook;
  try {
    body = (await req.json()) as GreenWebhook;
  } catch {
    return NextResponse.json({ ok: true, skip: "bad json" });
  }

  // Green API שולח סוגי webhook רבים (סטטוסים, מצב instance) - עונים רק להודעה נכנסת
  if (body?.typeWebhook !== "incomingMessageReceived") {
    return NextResponse.json({ ok: true, skip: body?.typeWebhook || "no type" });
  }

  const chatId = body.senderData?.chatId || "";
  const idMessage = body.idMessage || "";
  const text = extractText(body.messageData);
  if (!chatId || !text) return NextResponse.json({ ok: true, skip: "no text" });

  const isGroup = chatId.endsWith("@g.us");
  const botWid = BOT_NUMBER ? `${BOT_NUMBER}@c.us` : "";
  const mentioned = !!BOT_NUMBER && (text.includes("@" + BOT_NUMBER) || mentionedList(body.messageData).includes(botWid));

  // קבוצה: רק אם תייגו את הבוט. 1:1: תמיד (ההודעה ממילא מכוונת אליו).
  if (isGroup && !mentioned) return NextResponse.json({ ok: true, skip: "not mentioned" });

  if (await alreadyHandled(idMessage)) return NextResponse.json({ ok: true, skip: "duplicate" });

  const question = BOT_NUMBER ? text.replace(new RegExp("@" + BOT_NUMBER + "\\s*", "g"), "").trim() : text;
  if (!question) return NextResponse.json({ ok: true, skip: "empty after mention" });

  if (!greenApiConfigured()) return NextResponse.json({ ok: true, skip: "green api not configured" });

  try {
    const { reply, toolLog } = await runTabitChat([{ role: "user", content: question }], { forceReadOnly: true, extraSystem: GROUP_SYSTEM });
    await sendGreenMessage(chatId, reply);
    // תיעוד להיסטוריית המעבדה (מעקב ובקרה של המנהל) - סשן קבוע לכל קבוצה
    const sender = body.senderData?.senderName || "חבר קבוצה";
    await appendLabExchange({
      sessionId: `grp-${chatId.replace(/\D/g, "").slice(-12) || "group"}`,
      source: "group",
      title: `וואטסאפ · ${body.senderData?.chatName || chatId}`.slice(0, 60),
      userContent: `${sender}: ${question}`,
      assistantContent: reply,
      toolLog: toolLog as LabToolEntry[],
    }).catch(() => {});
  } catch {
    // לא מפילים את הוובהוק (Green API יסמן טופל); מנסים להודיע בשקט בקבוצה
    try {
      await sendGreenMessage(chatId, "לא הצלחתי למשוך את המידע מטאביט כרגע, נסו שוב עוד רגע.");
    } catch {
      /* ignore */
    }
  }
  return NextResponse.json({ ok: true });
}
