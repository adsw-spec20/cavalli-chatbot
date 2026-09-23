import { NextRequest, NextResponse } from "next/server";
import { safeTokenEqual } from "@/lib/admin-auth";
import { claimNext, submitResult, isLabHot } from "@/lib/tabit-queue";

/**
 * נקודת הקצה של הסוכן המקומי (tabit-automation/agent.js).
 * מכונה-אל-מכונה: אין עוגייה, לכן פטור משער העוגייה ב-middleware (PUBLIC_PATHS)
 * ומאומת כאן בסוד TABIT_SYNC_SECRET (אותו סוד של הסנכרון).
 *
 *   GET  -> תפוס את הפקודה הממתינה הבאה (או {command:null})
 *   POST -> החזר תוצאה: { id, status: "done"|"error", result, error }
 */

export const runtime = "nodejs";

function authed(req: NextRequest): boolean {
  const secret = process.env.TABIT_SYNC_SECRET;
  if (!secret) return false;
  return safeTokenEqual(secret, req.headers.get("x-tabit-sync-secret") ?? "");
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // hot = מישהו פתח את המעבדה עכשיו. הסוכן עובר לסריקה מהירה עוד לפני שנשלחה
  // הפקודה הראשונה, וכך השאלה הראשונה לא משלמת את מחיר הסריקה האיטית.
  const [command, hot] = await Promise.all([claimNext(), isLabHot()]);
  return NextResponse.json({ command, hot });
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: { id?: string; status?: string; result?: unknown; error?: string } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  if (!body.id || (body.status !== "done" && body.status !== "error")) {
    return NextResponse.json({ error: "missing id/status" }, { status: 400 });
  }
  await submitResult(body.id, body.status, body.result, body.error ?? null);
  return NextResponse.json({ ok: true });
}
