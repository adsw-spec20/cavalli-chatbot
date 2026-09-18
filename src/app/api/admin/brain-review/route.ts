import { NextRequest, NextResponse } from "next/server";
import { isMasterAuthorized } from "@/lib/admin-auth";
import { getOverview, getTopicQuestions, applyAnswer, undoAnswer, type AnswerStatus } from "@/lib/brain-review";

/**
 * בירור המוח - למנהל הראשי בלבד.
 * GET              -> מפת הנושאים וההתקדמות
 * GET ?topic=key   -> שאלות הנושא (מנסח בדרך את מה שעוד לא נוסח)
 * POST             -> תשובה אחת, שנכנסת לבוט מיד; או ביטול החלטה.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const STATUSES: AnswerStatus[] = ["kept", "changed", "deleted", "answered", "irrelevant", "unsure", "skipped"];

export async function GET(req: NextRequest) {
  if (!isMasterAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const topic = req.nextUrl.searchParams.get("topic");
  try {
    const data = topic ? await getTopicQuestions(topic) : await getOverview();
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isMasterAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: { questionId?: string; status?: string; answer?: string; action?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const questionId = String(body.questionId || "");
  if (!questionId) return NextResponse.json({ error: "missing questionId" }, { status: 400 });

  try {
    if (body.action === "undo") {
      await undoAnswer(questionId);
      return NextResponse.json({ ok: true });
    }
    const status = body.status as AnswerStatus;
    if (!STATUSES.includes(status)) return NextResponse.json({ error: "bad status" }, { status: 400 });
    await applyAnswer({ questionId, status, answer: body.answer });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
