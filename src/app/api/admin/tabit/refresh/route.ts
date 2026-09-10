import { NextRequest, NextResponse } from "next/server";
import { isMasterAuthorized } from "@/lib/admin-auth";
import { runCommand } from "@/lib/tabit-queue";

/**
 * רענון חי: מבקש מהסוכן המקומי לדחוף snapshot עכשיו, במקום לחכות למחזור
 * ה-5 דקות. הפאנל קורא לזה מכפתור "רענון חי" ואז מושך מחדש את /tabit.
 * עשוי לקחת עד ~20 שניות (הסוכן קולט פקודות עד כל 15 שניות במצב שקט).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!isMasterAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const result = await runCommand("refresh_snapshot", {}, 40_000);
    return NextResponse.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "failed" },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
