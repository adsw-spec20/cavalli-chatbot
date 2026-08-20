import { NextRequest, NextResponse } from "next/server";
import { sendDailyReport } from "@/lib/daily-report";
import { israelDateISO } from "@/lib/business-hours";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * דוח יומי - מופעל ע"י Vercel Cron כל בוקר (ראה vercel.json).
 * מסכם את היום הקודם ושולח לבעלים במייל.
 *
 * אבטחה: Vercel שולח Authorization: Bearer <CRON_SECRET> אוטומטית כשהמשתנה
 * מוגדר. בלי הכותרת הנכונה - 401 (שאף אחד לא יפעיל דוחות מבחוץ).
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // "אתמול" לפי שעון ישראל
  const today = israelDateISO();
  const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const sent = await sendDailyReport(yesterday);
  return NextResponse.json({ date: yesterday, sent });
}
