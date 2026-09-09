import { NextRequest, NextResponse } from "next/server";
import { isMasterAuthorized } from "@/lib/admin-auth";
import { runCommand } from "@/lib/tabit-queue";

/**
 * סטטוס תזכורת/פיקדון (שלב 1, קריאה בלבד) - למנהל הראשי בלבד.
 * לכל הזמנה: האם נשלח קישור פיקדון/תזכורת ומתי (מלוג ההתראות של טאביט).
 * שאילתה לפי-דרישה. ?day=today|tomorrow|YYYY-MM-DD או ?reservationId=...
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!isMasterAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const reservationId = url.searchParams.get("reservationId");
  const day = url.searchParams.get("day") || "today";
  const params = reservationId ? { reservationId } : { day };
  try {
    const result = await runCommand("notification_status", params, 45_000);
    return NextResponse.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "failed" },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
