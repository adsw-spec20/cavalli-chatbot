import { NextRequest, NextResponse } from "next/server";
import { isMasterAuthorized } from "@/lib/admin-auth";
import { listLabSessions } from "@/lib/tabit-lab-store";

/** רשימת שיחות המעבדה/בוט-הקבוצה (מנהל בלבד) - למעקב ובקרה. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isMasterAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sessions = await listLabSessions();
  return NextResponse.json({ sessions }, { headers: { "Cache-Control": "no-store" } });
}
