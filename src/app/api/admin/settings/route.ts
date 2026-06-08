import { NextRequest, NextResponse } from "next/server";
import { getBotEnabled, setBotEnabled } from "@/lib/admin-service";
import { isAdminAuthorized } from "@/lib/admin-auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ botEnabled: await getBotEnabled() });
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json();
  if (typeof body.botEnabled === "boolean") {
    await setBotEnabled(body.botEnabled);
    return NextResponse.json({ botEnabled: body.botEnabled });
  }
  return NextResponse.json({ error: "botEnabled (bool) required" }, { status: 400 });
}
