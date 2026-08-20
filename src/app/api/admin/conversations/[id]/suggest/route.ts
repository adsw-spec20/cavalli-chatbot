import { NextRequest, NextResponse } from "next/server";
import { suggestReply, polishDraft } from "@/lib/admin-service";
import { isAdminAuthorized } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const maxDuration = 90;

/**
 * עם body {text}: ליטוש ניסוח של טיוטת הנציג (לא ממציא תשובה).
 * בלי text: התנהגות ישנה - הצעת תשובה מלאה (נשמר לתאימות, הפאנל כבר לא משתמש בזה).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAdminAuthorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { text?: string };
  try {
    if (body.text?.trim()) {
      return NextResponse.json({ suggestion: await polishDraft(id, body.text) });
    }
    return NextResponse.json({ suggestion: await suggestReply(id) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "error" }, { status: 500 });
  }
}
