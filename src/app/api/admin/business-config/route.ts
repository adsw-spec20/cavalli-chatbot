import { NextRequest, NextResponse } from "next/server";
import {
  getBusinessConfig,
  updateBusinessConfig,
  defaultBusinessConfig,
} from "@/lib/admin-service";
import { isAdminAuthorized } from "@/lib/admin-auth";
import type { BusinessConfig } from "@/lib/business-config";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // מחזיר גם את הגרסה הנוכחית וגם את ברירת המחדל (ל"אפס לברירת מחדל" בפאנל)
  return NextResponse.json({
    config: await getBusinessConfig(),
    default: defaultBusinessConfig(),
  });
}

export async function PUT(req: NextRequest) {
  if (!isAdminAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const config = (await req.json()) as BusinessConfig;
  if (!config || typeof config.name !== "string") {
    return NextResponse.json({ error: "invalid config" }, { status: 400 });
  }
  await updateBusinessConfig(config);
  return NextResponse.json({ ok: true });
}
