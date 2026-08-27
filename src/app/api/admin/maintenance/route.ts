import { NextRequest, NextResponse } from "next/server";
import { isMasterAuthorized } from "@/lib/admin-auth";
import { getRepo } from "@/lib/db";
import { loadReservations } from "@/lib/reservations";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * כלי תחזוקה - מנהל ראשי בלבד.
 *
 * merge-duplicates: מאתר לקוחות עם יותר משיחה אחת (תוצר מרוץ הוובהוקים
 * שנחסם ב-27.8 עם מזהים דטרמיניסטיים) וממזג את כולן לוותיקה ביותר:
 * ההודעות עוברות, ההזמנות מוצבעות מחדש, כפולי mid מנוקים, והריקות נמחקות.
 * שום הודעה לא נמחקת מלבד עותקים זהים של אותה הודעת ערוץ (אותו mid).
 *
 * dry-run (ברירת המחדל): מחזיר דוח בלי לשנות כלום. הרצה אמיתית דורשת
 * {confirm: "merge"} בגוף הבקשה.
 */
export async function POST(req: NextRequest) {
  if (!isMasterAuthorized(req)) {
    return NextResponse.json({ error: "master only" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  if (body.action !== "merge-duplicates") {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
  const execute = body.confirm === "merge";

  const repo = getRepo();
  const all = await repo.listConversations();
  const byCustomer = new Map<string, typeof all>();
  for (const c of all) {
    const list = byCustomer.get(c.customerId) ?? [];
    list.push(c);
    byCustomer.set(c.customerId, list);
  }

  const report: Array<{
    customerId: string;
    kept: string;
    merged: string[];
    dedupedMids?: number;
  }> = [];

  for (const [customerId, convs] of byCustomer) {
    if (convs.length < 2) continue;
    // הוותיקה ביותר שורדת - ההיסטוריה הכי מלאה, וכל שאר ההודעות מצטרפות אליה
    const sorted = [...convs].sort((a, b) => a.createdAt - b.createdAt);
    const survivor = sorted[0];
    const dups = sorted.slice(1);
    const entry = {
      customerId,
      kept: survivor.id,
      merged: dups.map((d) => d.id),
      dedupedMids: 0,
    };

    if (execute) {
      for (const dup of dups) {
        await repo.mergeConversationInto(dup.id, survivor.id);
      }
      // אחרי איחוד: אותה הודעת ערוץ עשויה להופיע פעמיים (כל שרת שמר עותק
      // לשיחה שלו) - מסירים את הכפולים לפי mid
      entry.dedupedMids = await repo.dedupeMessagesByMid(survivor.id);
      // הזמנות שהצביעו על שיחה שמוזגה - מצביעות עכשיו על השורדת
      const reservations = await loadReservations();
      const affected = reservations.filter((r) => entry.merged.includes(r.conversationId));
      if (affected.length) {
        for (const r of affected) r.conversationId = survivor.id;
        await getRepo().setSetting("reservations", JSON.stringify(reservations));
      }
    }
    report.push(entry);
  }

  return NextResponse.json({
    mode: execute ? "executed" : "dry-run",
    duplicateCustomers: report.length,
    report,
  });
}
