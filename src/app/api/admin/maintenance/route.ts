import { NextRequest, NextResponse } from "next/server";
import { isMasterAuthorized } from "@/lib/admin-auth";
import { getRepo } from "@/lib/db";
import { loadReservations } from "@/lib/reservations";

export const runtime = "nodejs";
export const maxDuration = 300;

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
  // עיבוד במנות (ברירת מחדל 40 לקוחות לקריאה) - הרצה חוזרת ממשיכה מהנותרים
  const limit = typeof body.limit === "number" && body.limit > 0 ? body.limit : 40;

  const repo = getRepo();
  const all = await repo.listConversations();
  const byCustomer = new Map<string, typeof all>();
  for (const c of all) {
    const list = byCustomer.get(c.customerId) ?? [];
    list.push(c);
    byCustomer.set(c.customerId, list);
  }

  const dupCustomers = [...byCustomer.entries()].filter(([, l]) => l.length > 1);
  const batch = execute ? dupCustomers.slice(0, limit) : dupCustomers;

  const report: Array<{
    customerId: string;
    kept: string;
    merged: string[];
    dedupedMids?: number;
  }> = [];

  const reservations = execute ? await loadReservations() : [];
  let reservationsChanged = false;

  for (const [customerId, convs] of batch) {
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
      // מצב "חשוב" לא הולך לאיבוד: אם אחת הכפולות בטיפול נציג / מוסלמת /
      // מושהית - השורדת מאמצת את זה. סגורה נשארת סגורה רק אם כולן סגורות.
      const anyHuman = sorted.some((c) => c.status === "human");
      const anyOpen = sorted.some((c) => c.status !== "closed");
      const escalatedSrc = [...sorted].reverse().find((c) => c.escalated);
      await repo.updateConversation(survivor.id, {
        status: anyHuman ? "human" : anyOpen ? "bot" : "closed",
        escalated: sorted.some((c) => c.escalated) || undefined,
        escalationReason: escalatedSrc?.escalationReason,
        escalationSummary: escalatedSrc?.escalationSummary,
        botPaused: sorted.some((c) => c.botPaused) || undefined,
        disclosedAi: sorted.some((c) => c.disclosedAi) || undefined,
        meta: sorted.some((c) => c.meta?.urgent) ? { ...(survivor.meta || {}), urgent: true } : survivor.meta,
      });
      for (const dup of dups) {
        await repo.mergeConversationInto(dup.id, survivor.id);
      }
      // אחרי איחוד: אותה הודעת ערוץ עשויה להופיע פעמיים (כל שרת שמר עותק
      // לשיחה שלו) - מסירים את הכפולים לפי mid
      entry.dedupedMids = await repo.dedupeMessagesByMid(survivor.id);
      // הזמנות שהצביעו על שיחה שמוזגה - מצביעות עכשיו על השורדת
      for (const r of reservations) {
        if (entry.merged.includes(r.conversationId)) {
          r.conversationId = survivor.id;
          reservationsChanged = true;
        }
      }
    }
    report.push(entry);
  }

  if (execute && reservationsChanged) {
    await repo.setSetting("reservations", JSON.stringify(reservations));
  }

  return NextResponse.json({
    mode: execute ? "executed" : "dry-run",
    duplicateCustomers: dupCustomers.length,
    processed: batch.length,
    remaining: execute ? dupCustomers.length - batch.length : 0,
    report,
  });
}
