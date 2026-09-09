import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthorized } from "@/lib/admin-auth";
import { sendProactiveTemplate } from "@/lib/proactive-send";

/**
 * תזכורת פיקדון עם קישור תשלום אמיתי (כפתור "פיקדון" בתיבת הפניות, נגיש לצוות).
 * שולח ללקוח בוואטסאפ את התבנית payment_reminder_v3 עם הקישור ({{1}}) של ההזמנה.
 * הודעה אחת שכוללת את הקישור - מחליף את "SMS + תזכורת גנרית". דורש אישור לפני
 * (הדיאלוג בפאנל) ותבנית מאושרת במטא. אם התבנית עוד לא אושרה, מטא תחזיר שגיאה ברורה.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { phone?: string; link?: string; name?: string; agentName?: string };
  if (!body.phone || !body.link) {
    return NextResponse.json({ error: "חסר טלפון או קישור פיקדון" }, { status: 400 });
  }
  const r = await sendProactiveTemplate({
    kind: "payment_link",
    phone: body.phone,
    agentName: body.agentName,
    bodyParams: [body.link],
  });
  return r.ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: r.error, detail: r.detail }, { status: r.status });
}
