import { NextRequest, NextResponse } from "next/server";
import { isMasterAuthorized } from "@/lib/admin-auth";
import { getRepo } from "@/lib/db";

/**
 * ייצוא שיחות לניתוח (מנהל ראשי בלבד, קריאה בלבד).
 *
 * למה היה צריך את זה: נתיב השיחות של הפאנל מחזיר רק את ~300 האחרונות, ולכן
 * כל סריקה עד היום כיסתה 6% מהדאטה. כאן אפשר לעבור על הכל בעימוד.
 *
 * ?offset=0&limit=200  -> שיחות עם ההודעות שלהן, כולל meta (canned/gateReply),
 * שבלעדיו אי אפשר להבחין בין תשובה חינמית לתשובה בתשלום.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_LIMIT = 300;

export async function GET(req: NextRequest) {
  if (!isMasterAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sp = req.nextUrl.searchParams;
  const offset = Math.max(0, Number(sp.get("offset") ?? 0) || 0);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(sp.get("limit") ?? 100) || 100));

  const repo = getRepo();
  const all = await repo.listConversations();
  const slice = all.slice(offset, offset + limit);

  const conversations = await Promise.all(
    slice.map(async (c) => ({
      id: c.id,
      channel: c.channel,
      status: c.status,
      escalated: c.escalated ?? false,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      messages: (await repo.getMessages(c.id)).map((m) => ({
        role: m.role,
        content: m.content,
        ts: m.ts,
        meta: m.meta ?? undefined,
      })),
    }))
  );

  return NextResponse.json(
    { total: all.length, offset, limit, returned: conversations.length, conversations },
    { headers: { "Cache-Control": "no-store" } }
  );
}
