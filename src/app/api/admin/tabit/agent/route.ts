import { NextRequest, NextResponse } from "next/server";
import { safeTokenEqual } from "@/lib/admin-auth";
import { claimNext, submitResult } from "@/lib/tabit-queue";

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
  const command = await claimNext();
  return NextResponse.json({ command });
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
