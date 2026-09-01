import { NextRequest, NextResponse } from "next/server";
import { isMasterAuthorized } from "@/lib/admin-auth";
import { getRepo } from "@/lib/db";

/**
 * הגשת ה-snapshot מטאביט לפאנל - למנהל הראשי בלבד (isMasterAuthorized).
 * מכוון: מידע ההזמנות (שמות, טלפונים) לא נחשף לאנשי צוות רגילים, רק לך.
 * קריאה בלבד - הפאנל לא כותב שום דבר חזרה לטאביט.
 */

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!isMasterAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const configured = !!process.env.TABIT_SYNC_SECRET;
  const raw = await getRepo().getSetting("tabit_snapshot");
  if (!raw) {
    return NextResponse.json({ configured, snapshot: null });
  }
  try {
    return NextResponse.json({ configured, snapshot: JSON.parse(raw) });
  } catch {
    return NextResponse.json({ configured, snapshot: null });
  }
}
