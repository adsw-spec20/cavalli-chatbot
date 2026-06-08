import { NextRequest, NextResponse } from "next/server";
import { listKnowledge } from "@/lib/admin-service";
import { isAdminAuthorized } from "@/lib/admin-auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const status = req.nextUrl.searchParams.get("status") as
    | "open"
    | "answered"
    | null;
  return NextResponse.json(await listKnowledge(status ?? undefined));
}
