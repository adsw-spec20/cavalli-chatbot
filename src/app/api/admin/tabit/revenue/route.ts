import { NextRequest, NextResponse } from "next/server";
import { isMasterAuthorized } from "@/lib/admin-auth";
import { runCommand } from "@/lib/tabit-queue";

/**
 * אנליטיקת הכנסות (שלב 1, קריאה בלבד) - למנהל הראשי בלבד.
 * נמשך חי מהסוכן דרך תור הפקודות (revenue_summary): חשבון ממוצע, טיפים, הכנסה.
 * שאילתה לפי-דרישה (לא פולינג) כדי לא לשרוף CPU. ?day=YYYY-MM-DD או ?days=N.
 * הנתונים רגישים - לכן master בלבד ומבודד מהצ'אט הציבורי.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!isMasterAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const day = url.searchParams.get("day");
  const days = url.searchParams.get("days");
  const params = day ? { day } : { days: Number(days) || 7 };
  try {
    const result = await runCommand("revenue_summary", params, 45_000);
    return NextResponse.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    // 200 עם ok:false - כדי שהפאנל יציג הודעה ידידותית אם הסוכן לא רץ, בלי שגיאת רשת
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "failed" },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
