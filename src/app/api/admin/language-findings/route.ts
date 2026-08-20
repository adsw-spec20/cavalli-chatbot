import { NextRequest, NextResponse } from "next/server";
import { isMasterAuthorized } from "@/lib/admin-auth";
import { getRepo } from "@/lib/db";

export const runtime = "nodejs";

/** ממצאי הבדיקה הלילית של הלשון (14 ימים אחרונים) - לקריאה ואיסוף לתיקון. */
export async function GET(req: NextRequest) {
  if (!isMasterAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const raw = (await getRepo().getSetting("language_findings")) ?? "[]";
    return NextResponse.json(JSON.parse(raw));
  } catch {
    return NextResponse.json([]);
  }
}
