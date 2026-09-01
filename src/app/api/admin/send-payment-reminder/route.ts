import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthorized } from "@/lib/admin-auth";
import { sendProactiveTemplate } from "@/lib/proactive-send";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * תזכורת יזומה ללקוח שההזמנה שלו ממתינה להשלמת תשלום הפיקדון.
 * הלוגיקה עצמה משותפת עם שליחת החניה - ראה lib/proactive-send.ts.
 */
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { phone?: string; agentName?: string };
  const r = await sendProactiveTemplate({
    kind: "payment",
    phone: body.phone ?? "",
    agentName: body.agentName,
  });
  return r.ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: r.error, detail: r.detail }, { status: r.status });
}
