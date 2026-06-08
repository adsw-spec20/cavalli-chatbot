import { NextRequest, NextResponse } from "next/server";
import { answerKnowledge, deleteKnowledge } from "@/lib/admin-service";
import { isAdminAuthorized } from "@/lib/admin-auth";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdminAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json();

  if (body.action === "delete") {
    await deleteKnowledge(id);
    return NextResponse.json({ ok: true });
  }
  if (typeof body.answer === "string" && body.answer.trim()) {
    const result = await answerKnowledge(id, body.answer.trim());
    return NextResponse.json(result);
  }
  return NextResponse.json({ error: "answer or action required" }, { status: 400 });
}
