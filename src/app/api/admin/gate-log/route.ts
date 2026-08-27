import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthorized } from "@/lib/admin-auth";
import { getRepo } from "@/lib/db";

export const runtime = "nodejs";

/**
 * יומן פעילות השער לדשבורד: פתיחות, חסימות וכשלים - מי, מתי ומה קרה.
 * נגזר ישירות מהודעות המערכת של השער (מקור אמת אחד, בלי רישום כפול).
 */
export async function GET(req: NextRequest) {
  if (!(await isAdminAuthorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const events = await getRepo().listGateEvents(300);
  const weekAgo = Date.now() - 7 * 24 * 3600_000;
  return NextResponse.json({
    events,
    openedLast7Days: events.filter((e) => e.result === "opened" && e.ts > weekAgo).length,
  });
}
