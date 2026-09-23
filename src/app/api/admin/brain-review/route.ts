import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { isMasterAuthorized } from "@/lib/admin-auth";
import {
  getOverview,
  getTopicQuestions,
  applyAnswer,
  undoAnswer,
  prewarmQuestions,
  saveNote,
  exportReview,
  resetReview,
  getAnsweredQuestions,
  rephraseQuestions,
  type AnswerStatus,
} from "@/lib/brain-review";

/**
 * בירור המוח - למנהל הראשי בלבד.
 * GET              -> מפת הנושאים וההתקדמות
 * GET ?topic=key   -> שאלות הנושא (מנסח בדרך את מה שעוד לא נוסח)
 * GET ?prewarm=1   -> מנסח ברקע את כל מה שחסר, ומחזיר תשובה מיד
 * POST             -> תשובה אחת, שנכנסת לבוט מיד; או ביטול החלטה.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const STATUSES: AnswerStatus[] = [
  "kept",
  "changed",
  "deleted",
  "answered",
  "irrelevant",
  "unsure",
  "technical",
  "skipped",
];

export async function GET(req: NextRequest) {
  if (!isMasterAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const topic = req.nextUrl.searchParams.get("topic");
  // ההכנה רצה אחרי שהתשובה נשלחה, כדי שהמסך לא יחכה לה
  if (req.nextUrl.searchParams.get("prewarm")) {
    after(() => prewarmQuestions().catch(() => undefined));
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  }
  // הסיכום להרכבת מוח חדש - קובץ טקסט להורדה
  if (req.nextUrl.searchParams.get("export")) {
    try {
      const md = await exportReview();
      return new NextResponse(md, {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="brain-review-${new Date().toISOString().slice(0, 10)}.md"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
    }
  }
  try {
    const data = req.nextUrl.searchParams.get("answered")
      ? await getAnsweredQuestions()
      : topic
        ? await getTopicQuestions(topic)
        : await getOverview();
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isMasterAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: { questionId?: string; status?: string; answer?: string; action?: string; note?: string; confirm?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  // ניסוח מחדש של כל השאלות (התשובות נשמרות) - ההכנה ממשיכה ברקע
  if (body.action === "rephrase") {
    try {
      const r = await rephraseQuestions();
      after(() => prewarmQuestions().catch(() => undefined));
      return NextResponse.json({ ok: true, ...r });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
    }
  }

  // איפוס הכל - הפעולה היחידה שאינה על שאלה מסוימת, ודורשת אישור מפורש
  if (body.action === "reset") {
    if (body.confirm !== "reset") return NextResponse.json({ error: "missing confirm" }, { status: 400 });
    try {
      return NextResponse.json({ ok: true, ...(await resetReview()) });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
    }
  }

  const questionId = String(body.questionId || "");
  if (!questionId) return NextResponse.json({ error: "missing questionId" }, { status: 400 });

  try {
    if (body.action === "undo") {
      await undoAnswer(questionId);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "note") {
      await saveNote(questionId, String(body.note ?? ""));
      return NextResponse.json({ ok: true });
    }
    const status = body.status as AnswerStatus;
    if (!STATUSES.includes(status)) return NextResponse.json({ error: "bad status" }, { status: 400 });
    await applyAnswer({ questionId, status, answer: body.answer, note: body.note });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
