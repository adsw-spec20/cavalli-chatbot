import { NextRequest, NextResponse } from "next/server";
import { listConversations, searchConversations } from "@/lib/admin-service";
import { isAdminAuthorized } from "@/lib/admin-auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // ?q=... - חיפוש בכל הזמנים (מחזיר רק התאמות); בלי q - 300 השיחות האחרונות
  const q = req.nextUrl.searchParams.get("q");
  if (q && q.trim().length >= 2) return NextResponse.json(await searchConversations(q));
  return NextResponse.json(await listConversations());
}
