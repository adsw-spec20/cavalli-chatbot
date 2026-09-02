import { NextRequest, NextResponse } from "next/server";
import { safeTokenEqual } from "@/lib/admin-auth";
import { getRepo } from "@/lib/db";

/**
 * Webhook "בריאות החיבור" ל-Make. הסוכן דוחף snapshot כל ~5 דקות; אם ה-snapshot
 * ישן מדי = החיבור נפל (מחשב כבוי / סוכן נסגר / תקלה מתמשכת - מה שההתחברות
 * האוטומטית לא מכסה). Make קורא כל כמה דקות; אם alert=true - שולח התראה.
 *
 * דה-באונס: alert=true רק בכניסה למצב "נפל" ואז לכל היותר פעם ב-cooldown דקות,
 * כדי לא להציף. חוזר למצב תקין מאפס את הדה-באונס (נפילה חדשה תתריע מיד).
 *
 * מכונה-אל-מכונה: פטור משער העוגייה (PUBLIC_PATHS), מאומת ב-TABIT_SYNC_SECRET.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LAST_ALERT_KEY = "tabit_health_last_alert";

function authed(req: NextRequest): boolean {
  const secret = process.env.TABIT_SYNC_SECRET;
  if (!secret) return false;
  const given = req.headers.get("x-tabit-sync-secret") || new URL(req.url).searchParams.get("key") || "";
  return safeTokenEqual(secret, given);
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const staleMin = Math.max(1, parseInt(url.searchParams.get("stale") || "15", 10) || 15);
  const cooldownMin = Math.max(1, parseInt(url.searchParams.get("cooldown") || "60", 10) || 60);
  const now = Date.now();

  const raw = await getRepo().getSetting("tabit_snapshot");
  let generatedAt = 0;
  try { if (raw) generatedAt = (JSON.parse(raw) as { generatedAt?: number }).generatedAt || 0; } catch {}
  const ageMin = generatedAt ? Math.round((now - generatedAt) / 60000) : null;
  const alive = ageMin != null && ageMin <= staleMin;

  let alert = false;
  if (alive) {
    // תקין - מאפסים את הדה-באונס כדי שנפילה הבאה תתריע מיד
    await getRepo().setSetting(LAST_ALERT_KEY, "");
  } else {
    const lastRaw = await getRepo().getSetting(LAST_ALERT_KEY);
    const lastAlert = lastRaw ? Number(lastRaw) || 0 : 0;
    if (now - lastAlert > cooldownMin * 60000) {
      alert = true;
      await getRepo().setSetting(LAST_ALERT_KEY, String(now));
    }
  }

  const lastUpdateHe = generatedAt
    ? new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }).format(new Date(generatedAt))
    : "לא ידוע";
  const text =
    `*⚠️ החיבור לטאביט נפל*\n` +
    `הסוכן לא עדכן כבר ${ageMin == null ? "הרבה" : ageMin} דקות (עדכון אחרון: ${lastUpdateHe}).\n` +
    `בדוק שהמחשב דלוק ושהסוכן רץ - הפעל מחדש את run-agent.`;

  return NextResponse.json(
    { alive, alert, ageMinutes: ageMin, generatedAt, staleMin, text },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } }
  );
}
