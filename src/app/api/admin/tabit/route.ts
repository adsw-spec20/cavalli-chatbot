import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthorized } from "@/lib/admin-auth";
import { getRepo } from "@/lib/db";
import { loadDepositReminders } from "@/lib/deposit-reminders";

/**
 * הגשת ה-snapshot מטאביט לפאנל - לכל הצוות (נפתח לבקשת המנהל 15.9;
 * קודם היה מנהל בלבד). קריאה בלבד - הפאנל לא כותב שום דבר חזרה לטאביט.
 */

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const configured = !!process.env.TABIT_SYNC_SECRET;
  const raw = await getRepo().getSetting("tabit_snapshot");
  if (!raw) {
    return NextResponse.json({ configured, snapshot: null });
  }
  try {
    const snapshot = JSON.parse(raw) as { reservations?: { id?: string; reminderSentAt?: number }[] };
    // מצרפים "נשלחה תזכורת פיקדון" לכל הזמנה (למגירת הפרטים בתצוגת היום)
    try {
      const reminders = await loadDepositReminders();
      for (const r of snapshot.reservations ?? []) {
        if (r?.id && reminders[r.id]) r.reminderSentAt = reminders[r.id];
      }
    } catch {
      /* לא קריטי */
    }
    return NextResponse.json({ configured, snapshot });
  } catch {
    return NextResponse.json({ configured, snapshot: null });
  }
}
