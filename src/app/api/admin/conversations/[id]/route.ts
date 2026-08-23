import { NextRequest, NextResponse } from "next/server";
import { getConversationDetail } from "@/lib/admin-service";
import { isAdminAuthorized } from "@/lib/admin-auth";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAdminAuthorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  // ?all=1 - טעינת כל ההיסטוריה (כפתור "הצג הודעות קודמות" בפאנל)
  const detail = await getConversationDetail(id, {
    allMessages: req.nextUrl.searchParams.get("all") === "1",
  });
  if (!detail) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(detail);
}
