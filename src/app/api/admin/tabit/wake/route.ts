import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthorized } from "@/lib/admin-auth";
import { markLabActive } from "@/lib/tabit-queue";

/**
 * "המעבדה נפתחה" - מסמן לסוכן המקומי לעבור לסריקה מהירה.
 *
 * נקרא כשנפתחת לשונית המעבדה, לפני שנשאלה שאלה. עד אז השאלה הראשונה בכל שיחה
 * חיכתה עד 15 שניות רק כדי שהסוכן ישים לב אליה. קריאה אחת, בלי תור, בלי המתנה.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await markLabActive();
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
