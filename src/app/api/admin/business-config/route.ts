import { NextRequest, NextResponse } from "next/server";
import {
  getBusinessConfig,
  updateBusinessConfig,
  defaultBusinessConfig,
} from "@/lib/admin-service";
import { isAdminAuthorized } from "@/lib/admin-auth";
import { archivePastEvents, prunePastHoursOverrides } from "@/lib/business-config-store";
import { israelDateISO } from "@/lib/business-hours";
import type { BusinessConfig } from "@/lib/business-config";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // ניקיון: אירועים שעברו מועברים לארכיון (ההיסטוריה נשמרת, הקונפיג נשאר קטן).
  // נעשה כאן כי זו פעולה נדירה שלא נמצאת בנתיב ההודעות של הלקוחות.
  await archivePastEvents(israelDateISO()).catch(() => 0);
  // ניקוי דומה לשעות חריגות שתאריכן עבר
  await prunePastHoursOverrides(israelDateISO());

  // מחזיר גם את הגרסה הנוכחית וגם את ברירת המחדל (ל"אפס לברירת מחדל" בפאנל)
  return NextResponse.json({
    config: await getBusinessConfig(),
    default: defaultBusinessConfig(),
  });
}

export async function PUT(req: NextRequest) {
  if (!(await isAdminAuthorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const config = (await req.json()) as BusinessConfig;
  if (!config || typeof config.name !== "string") {
    return NextResponse.json({ error: "invalid config" }, { status: 400 });
  }
  await updateBusinessConfig(config);
  return NextResponse.json({ ok: true });
}
