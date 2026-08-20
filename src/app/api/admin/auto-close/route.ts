import { NextRequest, NextResponse } from "next/server";
import { isMasterAuthorized } from "@/lib/admin-auth";
import { getRepo } from "@/lib/db";
import { loadReservations } from "@/lib/reservations";
import { israelDateISO } from "@/lib/business-hours";

export const runtime = "nodejs";
export const maxDuration = 120;

const ANSWERED_QUIET_MS = 72 * 3600_000; // הבוט ענה אחרון: 72 שעות שקט
const ABANDONED_QUIET_MS = 7 * 24 * 3600_000; // הלקוח כתב אחרון ונעלם: 7 ימים

/**
 * מטאטא סגירת שיחות (מנהל בלבד). ברירת מחדל: דיווח בלבד (dry run) - מחזיר את
 * רשימת המועמדות בלי לסגור. סגירה בפועל רק עם {execute:true}.
 * חסינות: אצל נציג, הסלמה, בוט מושהה, הזמנה פעילה (עד יום אחרי המועד).
 */
export async function POST(req: NextRequest) {
  if (!isMasterAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { execute?: boolean };
  const repo = getRepo();
  const [summaries, reservations] = await Promise.all([repo.getConversationSummaries(), loadReservations()]);
  const today = israelDateISO();
  // שיחות עם הזמנה חיה: ממתינה, או מאושרת שמועדה עוד לא עבר (כולל יום האירוע)
  const protectedConvs = new Set(
    reservations
      .filter((r) => r.status === "pending" || (r.status === "approved" && r.dateISO && r.dateISO >= today))
      .map((r) => r.conversationId)
  );
  const now = Date.now();
  const candidates = summaries
    .filter((s) => {
      const c = s.conversation;
      if (c.status !== "bot" || c.escalated || c.botPaused) return false;
      if (protectedConvs.has(c.id)) return false;
      const quiet = now - c.updatedAt;
      return s.lastMessageRole === "user" ? quiet > ABANDONED_QUIET_MS : quiet > ANSWERED_QUIET_MS;
    })
    .map((s) => ({
      id: s.conversation.id,
      name: s.customerName ?? "לקוח",
      channel: s.conversation.channel,
      quietHours: Math.round((now - s.conversation.updatedAt) / 3600_000),
      lastRole: s.lastMessageRole,
      lastMessage: (s.lastMessage ?? "").slice(0, 60),
    }));

  if (!body.execute) {
    return NextResponse.json({ dryRun: true, count: candidates.length, sample: candidates.slice(0, 15) });
  }

  let closed = 0;
  for (const c of candidates) {
    await repo.addMessage({
      conversationId: c.id,
      role: "system",
      content: `🗂️ השיחה נסגרה אוטומטית (${c.lastRole === "user" ? "7 ימים ללא המשך" : "3 ימים של שקט אחרי מענה"})`,
      ts: Date.now(),
      meta: { activity: true, autoClosed: true },
    });
    await repo.updateConversation(c.id, { status: "closed" });
    closed++;
  }
  return NextResponse.json({ dryRun: false, closed });
}
