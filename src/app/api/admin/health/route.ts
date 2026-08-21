import { NextRequest, NextResponse } from "next/server";
import { getChannelHealth } from "@/lib/admin-service";
import { isAdminAuthorized } from "@/lib/admin-auth";
import { isGateConfigured, gateHoursBypassed } from "@/lib/palgate";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const health = await getChannelHealth();
  // סטטוס שער החניה (בוליאני בלבד, ללא סודות) - לאבחון שהפרודקשן רואה את משתני הסביבה
  return NextResponse.json({
    ...health,
    parkingGate: { configured: isGateConfigured(), hoursBypassed: gateHoursBypassed() },
  });
}
