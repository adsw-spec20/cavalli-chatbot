import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthorized } from "@/lib/admin-auth";
import { getRepo } from "@/lib/db";

export const runtime = "nodejs";

const KEY = "questionnaire_answers";

interface QAnswer {
  answer?: string;
  skipped?: boolean;
  ts: number;
  by?: string;
}

async function loadAnswers(): Promise<Record<string, QAnswer>> {
  try {
    const raw = await getRepo().getSetting(KEY);
    return raw ? (JSON.parse(raw) as Record<string, QAnswer>) : {};
  } catch {
    return {};
  }
}

/** תשובות שאלון הידע: נשמרות בשרת, נגישות לצוות ולתהליך ההטמעה. */
export async function GET(req: NextRequest) {
  if (!(await isAdminAuthorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await loadAnswers());
}

/** שמירת תשובה בודדת: { id, answer?, skipped?, by? } - עדכון מצטבר */
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    answer?: string;
    skipped?: boolean;
    by?: string;
  };
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const answers = await loadAnswers();
  const answer = (body.answer ?? "").trim();
  if (!answer && !body.skipped) {
    delete answers[body.id]; // מחיקת תשובה שהתרוקנה
  } else {
    answers[body.id] = { answer: answer || undefined, skipped: body.skipped || undefined, ts: Date.now(), by: body.by };
  }
  await getRepo().setSetting(KEY, JSON.stringify(answers));
  return NextResponse.json({ ok: true, answered: Object.keys(answers).length });
}
