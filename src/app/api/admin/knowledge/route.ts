import { NextRequest, NextResponse } from "next/server";
import { createKnowledge, listKnowledge } from "@/lib/admin-service";
import { isAdminAuthorized } from "@/lib/admin-auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const status = req.nextUrl.searchParams.get("status") as
    | "open"
    | "answered"
    | null;
  return NextResponse.json(await listKnowledge(status ?? undefined));
}

/** הוספת ידע יזומה: שאלה + תשובה מוכנות מהצוות. */
export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json();
  const question = typeof body.question === "string" ? body.question.trim() : "";
  const answer = typeof body.answer === "string" ? body.answer.trim() : "";
  if (question.length < 2 || !answer) {
    return NextResponse.json({ error: "question and answer required" }, { status: 400 });
  }
  return NextResponse.json(await createKnowledge(question, answer));
}
