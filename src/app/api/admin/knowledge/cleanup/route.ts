import { NextRequest, NextResponse } from "next/server";
import { isMasterAuthorized } from "@/lib/admin-auth";
import { getRepo } from "@/lib/db";
import { evaluateGapQuestion } from "@/lib/knowledge-filter";
import { classifyTopic } from "@/lib/insights";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * ניקוי רטרואקטיבי חד-פעמי של השאלות הפתוחות (מנהל בלבד):
 * מריץ כל שאלה קיימת דרך "המסנן החכם" - מנסח מחדש, מאחד כפילויות סמנטיות
 * (מעביר את השואלים לשאלה שנשארת), וזורק מה שאינו שאלת ידע.
 */
export async function POST(req: NextRequest) {
  if (!isMasterAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const repo = getRepo();
  const all = await repo.listLearnedQA();
  const answered = all.filter((q) => q.status === "answered");
  // מהישנה לחדשה - כדי שהכפילות המאוחרת תתאחד לתוך המוקדמת
  const open = all
    .filter((q) => q.status === "open")
    .sort((a, b) => a.createdAt - b.createdAt);

  const kept: typeof open = [];
  const log: { question: string; result: string }[] = [];

  for (const q of open) {
    const verdict = await evaluateGapQuestion(q.question, [...answered, ...kept]);

    if (verdict.action === "discard") {
      await repo.deleteLearnedQA(q.id);
      log.push({ question: q.question, result: "נמחקה (לא שאלת ידע)" });
      continue;
    }

    if (verdict.action === "duplicate" && verdict.duplicateId) {
      if (verdict.duplicateAnswered) {
        await repo.deleteLearnedQA(q.id);
        log.push({ question: q.question, result: "נמחקה (כבר יש תשובה בידע)" });
      } else {
        // העברת השואלים לשאלה שנשארת ומחיקת הכפולה
        for (const asker of q.askers ?? [
          ...(q.conversationId ? [{ conversationId: q.conversationId, ts: q.createdAt }] : []),
        ]) {
          await repo.recordLearnedQAAsk(verdict.duplicateId, asker);
        }
        await repo.deleteLearnedQA(q.id);
        const target = kept.find((k) => k.id === verdict.duplicateId);
        log.push({
          question: q.question,
          result: `אוחדה עם: "${target?.question ?? "שאלה קיימת"}"`,
        });
      }
      continue;
    }

    // נשארת - עם ניסוח משופר ונושא
    const newQuestion = verdict.question ?? q.question;
    if (newQuestion !== q.question) {
      await repo.updateLearnedQA(q.id, { question: newQuestion });
      log.push({ question: q.question, result: `נוסחה מחדש: "${newQuestion}"` });
    } else {
      log.push({ question: q.question, result: "נשארה כמו שהיא" });
    }
    kept.push({ ...q, question: newQuestion, topic: classifyTopic(newQuestion) });
  }

  return NextResponse.json({
    before: open.length,
    after: kept.length,
    log,
  });
}
