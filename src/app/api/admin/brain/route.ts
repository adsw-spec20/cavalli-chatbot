import { NextRequest, NextResponse } from "next/server";
import { isMasterAuthorized } from "@/lib/admin-auth";
import { buildBrainSnapshot } from "@/lib/brain";
import { setOverride, listHistory, revertTo } from "@/lib/brain-store";

/**
 * "מוח הבוט" - כל מה שהבוט יודע, במקום אחד. מנהל ראשי בלבד.
 *
 * GET  - תמונת מצב מלאה: שכבות, משקל בטוקנים, סתירות, ומה נערך.
 * PUT  - שמירת עריכה לפריט אחד (טקסט ריק = חזרה לברירת המחדל).
 * POST - {action:"revert", index} חזרה לגרסה קודמת.
 *
 * ⚠️ עריכה כאן משפיעה על הבוט החי מיד: הטקסט נכנס ל-System Prompt ולתשובות
 * החינמיות בהודעה הבאה. אין שלב פרסום נפרד.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isMasterAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  if (sp.get("history") === "1") {
    return NextResponse.json({ history: await listHistory() }, { headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json(await buildBrainSnapshot(sp.get("q") ?? ""), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PUT(req: NextRequest) {
  if (!isMasterAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json()) as { id?: string; text?: string; base?: string; note?: string };
  if (!body.id) return NextResponse.json({ error: "חסר מזהה פריט" }, { status: 400 });
  if (typeof body.text !== "string" || typeof body.base !== "string") {
    return NextResponse.json({ error: "חסר טקסט" }, { status: 400 });
  }
  // מעקה: טקסט ארוך בטירוף כנראה הדבקה בטעות, והוא מייקר כל הודעה
  if (body.text.length > 20000) {
    return NextResponse.json({ error: "הטקסט ארוך מדי (מעל 20,000 תווים)" }, { status: 400 });
  }
  const saved = await setOverride(body.id, body.text, body.base, body.note);
  return NextResponse.json({ ok: true, version: saved.version, edited: Object.keys(saved.items).length });
}

export async function POST(req: NextRequest) {
  if (!isMasterAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json()) as { action?: string; index?: number };
  if (body.action !== "revert" || typeof body.index !== "number") {
    return NextResponse.json({ error: "פעולה לא מוכרת" }, { status: 400 });
  }
  const restored = await revertTo(body.index);
  return NextResponse.json({ ok: true, version: restored.version, edited: Object.keys(restored.items).length });
}
