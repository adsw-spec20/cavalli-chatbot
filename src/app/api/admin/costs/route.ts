import { NextRequest, NextResponse } from "next/server";
import { getCostSummary } from "@/lib/usage";
import { isMasterAuthorized } from "@/lib/admin-auth";

export const runtime = "nodejs";

/**
 * מד העלות - נתונים פיננסיים, ולכן מוגן בטוקן המנהל הראשי בלבד
 * (לא נחשף לאנשי צוות רגילים).
 */
export async function GET(req: NextRequest) {
  if (!isMasterAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await getCostSummary());
}
