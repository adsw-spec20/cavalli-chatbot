import { NextRequest, NextResponse } from "next/server";
import { safeTokenEqual } from "@/lib/admin-auth";
import { getRepo } from "@/lib/db";
import { ingestLedger, type LedgerRecord } from "@/lib/tabit-ledger";

/**
 * קליטת snapshot של הזמנות מטאביט מהגשר המקומי (tabit-automation/sync.js).
 *
 * זהו נתיב מכונה-אל-מכונה: הגשר אינו דפדפן ואין לו עוגיית התחברות, לכן הוא
 * פטור משער העוגייה ב-middleware (ראה PUBLIC_PATHS) - ובמקום זה מאומת כאן
 * בסוד ייעודי TABIT_SYNC_SECRET (השוואת זמן-קבוע). הסוד נפרד לגמרי מקוד
 * המנהל (ADMIN_TOKEN): גם אם הגשר נפרץ, אין לו גישה לפאנל, ולהפך.
 *
 * הנתונים נשמרים כ-snapshot יחיד ב-KV (setSetting) - בלי מיגרציית סכימה.
 */

export const runtime = "nodejs";

// גבול שפיות על גודל ה-snapshot (מונע הצפת ה-KV אם משהו משתבש בגשר)
const MAX_RESERVATIONS = 2000;
// יום עמוס בקוואלי הוא ~300 רשומות ארכיון. הסוכן שולח את חלון 24 השעות,
// כלומר לכל היותר יומיים חלקיים.
const MAX_LEDGER_RECORDS = 3000;

export async function POST(req: NextRequest) {
  const secret = process.env.TABIT_SYNC_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "TABIT_SYNC_SECRET not configured" }, { status: 503 });
  }
  const given = req.headers.get("x-tabit-sync-secret") ?? "";
  if (!safeTokenEqual(secret, given)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const b = body as { reservations?: unknown; generatedAt?: unknown; dashboard?: unknown; floor?: unknown; ledger?: unknown };
  if (!Array.isArray(b.reservations)) {
    return NextResponse.json({ error: "missing reservations[]" }, { status: 400 });
  }
  if (b.reservations.length > MAX_RESERVATIONS) {
    return NextResponse.json({ error: "too many reservations" }, { status: 413 });
  }

  // dashboard + floor מעושרים בגשר (אם קיימים) - שדות אובייקט קטנים, מועברים כמו שהם
  const isObj = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
  const snapshot = {
    generatedAt: typeof b.generatedAt === "number" ? b.generatedAt : Date.now(),
    receivedAt: Date.now(),
    reservations: b.reservations,
    ...(isObj(b.dashboard) ? { dashboard: b.dashboard } : {}),
    ...(isObj(b.floor) ? { floor: b.floor } : {}),
  };

  await getRepo().setSetting("tabit_snapshot", JSON.stringify(snapshot));

  // פנקס היומיים: ההיסטוריה שטאביט לא נותן (הארכיון שלו מוגבל ל-24 שעות).
  // נכשל בשקט בכוונה - ה-snapshot כבר נשמר, וזו התוספת, לא העיקר.
  let ledgerDays: string[] = [];
  if (b.ledger && typeof b.ledger === "object" && !Array.isArray(b.ledger)) {
    try {
      const batch = b.ledger as Record<string, LedgerRecord[]>;
      const total = Object.values(batch).reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0);
      if (total <= MAX_LEDGER_RECORDS) {
        ledgerDays = (await ingestLedger(batch)).days;
      }
    } catch { /* הפנקס יתמלא בסבב הבא */ }
  }

  return NextResponse.json({ ok: true, count: b.reservations.length, ledgerDays });
}
