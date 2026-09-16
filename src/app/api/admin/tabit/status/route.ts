import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthorized } from "@/lib/admin-auth";
import { getRepo } from "@/lib/db";

/**
 * דופק הסוכן של טאביט - תשובה זעירה לפס ההתראה בראש מרכז טאביט.
 * הסוכן דוחף snapshot כל ~5 דק'; אם עברו הרבה יותר - הוא כנראה נפל.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const raw = await getRepo().getSetting("tabit_snapshot");
  // שולפים רק את generatedAt בלי לפרסר את כל ה-snapshot (הוא גדול)
  const m = raw?.match(/"generatedAt"\s*:\s*(\d+)/);
  const generatedAt = m ? Number(m[1]) : null;
  return NextResponse.json(
    {
      configured: !!process.env.TABIT_SYNC_SECRET,
      generatedAt,
      ageMinutes: generatedAt ? Math.round((Date.now() - generatedAt) / 60000) : null,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
