import { NextRequest, NextResponse } from "next/server";
import {
  answerKnowledge,
  deleteKnowledge,
  getKnowledgeItem,
  updateKnowledge,
} from "@/lib/admin-service";
import { isAdminAuthorized } from "@/lib/admin-auth";

export const runtime = "nodejs";

/**
 * עריכת פריט ידע קיים. תומך ב-baseTs למניעת דריסה שקטה: הלקוח שולח את חותמת
 * העדכון שהוא טען; אם הפריט השתנה בינתיים ממקום אחר - מוחזר 409 והעורך
 * מקבל הזדמנות לרענן במקום לדרוס.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdminAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json();
  const question = typeof body.question === "string" ? body.question.trim() : undefined;
  const answer = typeof body.answer === "string" ? body.answer.trim() : undefined;
  if (!question && !answer) {
    return NextResponse.json({ error: "question or answer required" }, { status: 400 });
  }
  const existing = await getKnowledgeItem(id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (typeof body.baseTs === "number") {
    const currentTs = existing.updatedAt ?? existing.answeredAt ?? existing.createdAt;
    if (currentTs !== body.baseTs) {
      return NextResponse.json(
        { error: "conflict", current: existing },
        { status: 409 }
      );
    }
  }
  const updated = await updateKnowledge(id, { question, answer });
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(updated);
}

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
