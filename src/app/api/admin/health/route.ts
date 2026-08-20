import { NextRequest, NextResponse } from "next/server";
import { getChannelHealth } from "@/lib/admin-service";
import { isAdminAuthorized } from "@/lib/admin-auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await getChannelHealth());
}
