import { NextRequest, NextResponse } from "next/server";
import {
  agentReply,
  answerKnowledge,
  deleteKnowledge,
  getKnowledgeItem,
  updateKnowledge,
} from "@/lib/admin-service";
import { isAdminAuthorized } from "@/lib/admin-auth";
import { getRepo } from "@/lib/db";

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
  if (!(await isAdminAuthorized(req))) {
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
  if (!(await isAdminAuthorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json();

  if (body.action === "delete") {
    await deleteKnowledge(id);
    return NextResponse.json({ ok: true });
  }

  // "שלח ללקוח ששאל": שולח את התשובה שנשמרה ישירות לשיחה של השואל
  if (body.action === "sendToAsker" && typeof body.conversationId === "string") {
    const qa = await getKnowledgeItem(id);
    if (!qa) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (!qa.answer) {
      return NextResponse.json({ error: "אין תשובה שמורה לשאלה הזו" }, { status: 400 });
    }
    const text = `היי 🙂 בהמשך לשאלה ששאלת אותנו - ${qa.answer}`;
    try {
      await agentReply(body.conversationId, text, body.agentName || "הצוות");
    } catch (err) {
      console.error("[knowledge] שליחת תשובה לשואל נכשלה:", err);
      return NextResponse.json({ error: "השליחה נכשלה" }, { status: 502 });
    }
    // סימון שהתשובה נשלחה לשואל הזה (כדי שהכפתור יהפוך ל"נשלח ✓")
    const askers = (qa.askers ?? []).map((a) =>
      a.conversationId === body.conversationId ? { ...a, answerSent: true } : a
    );
    await getRepo().setLearnedQAAskers(id, askers).catch(() => undefined);
    return NextResponse.json({ ok: true });
  }

  if (typeof body.answer === "string" && body.answer.trim()) {
    const result = await answerKnowledge(id, body.answer.trim());
    return NextResponse.json(result);
  }
  return NextResponse.json({ error: "answer or action required" }, { status: 400 });
}
