import { NextRequest, NextResponse } from "next/server";
import { isMasterAuthorized } from "@/lib/admin-auth";
import { buildBrainSnapshot } from "@/lib/brain";

/**
 * "מוח הבוט" - כל מה שהבוט יודע, במקום אחד. מנהל ראשי בלבד.
 *
 * מחזיר את כל השכבות (כללי ברזל, מאגר חינמי, מידע עסקי, ידע נלמד, מדיה,
 * הקשר דינמי) עם גודל בטוקנים, ואת רשימת הסתירות שזוהו ביניהן.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isMasterAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const q = req.nextUrl.searchParams.get("q") ?? "";
  return NextResponse.json(await buildBrainSnapshot(q), {
    headers: { "Cache-Control": "no-store" },
  });
}
