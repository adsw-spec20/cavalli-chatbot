import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthorized } from "@/lib/admin-auth";
import { listKnowledge } from "@/lib/admin-service";
import { countPendingReservations } from "@/lib/reservations";
import { getRepo } from "@/lib/db";

export const runtime = "nodejs";

/**
 * מוני הבועות של הפאנל בבקשה אחת קטנה.
 *
 * ביצועים (מובייל): עד עכשיו הפאנל משך כל 30 שניות שלוש תשובות מלאות (כל
 * שאלות הידע, כל ההזמנות, וכל 234 תשובות השאלון) רק כדי לחשב שלושה מספרים.
 * כאן מחזירים את המספרים בלבד - שאילתות במקביל, תשובה של עשרות בייטים.
 */
export async function GET(req: NextRequest) {
  if (!(await isAdminAuthorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const [openItems, pendingReservations, quizRaw] = await Promise.all([
    listKnowledge("open"),
    countPendingReservations(),
    getRepo().getSetting("questionnaire_answers"),
  ]);
  let quizDone = 0;
  try {
    const answers = quizRaw
      ? (JSON.parse(quizRaw) as Record<string, { answer?: string; skipped?: boolean }>)
      : {};
    quizDone = Object.values(answers).filter((a) => a.answer || a.skipped).length;
  } catch {
    /* אין תשובות */
  }
  return NextResponse.json({
    openQuestions: openItems.length,
    pendingReservations,
    quizDone,
  });
}
