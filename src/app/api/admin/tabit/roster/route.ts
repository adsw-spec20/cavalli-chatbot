import { NextRequest, NextResponse } from "next/server";
import { safeTokenEqual } from "@/lib/admin-auth";
import { getRepo } from "@/lib/db";
import { runCommand } from "@/lib/tabit-queue";

/**
 * רשימת אורחים ליום (שם · שולחן · טלפון) - נמשכת חי מטאביט (read_day), לא ידנית.
 * זו הגרסה האוטומטית של הרשימה שהמארחות מקלידות בקבוצה. מאומת ב-TABIT_SYNC_SECRET
 * (header x-tabit-sync-secret או ?key=). ?day=today|tomorrow|YYYY-MM-DD (ברירת מחדל: today).
 * מקור: קריאה חיה מהסוכן; נפילה ל-snapshot אם לא זמין.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TZ = "Asia/Jerusalem";
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

interface Row { name: string; seats: number; time: string; day: string; tables: number[]; phone?: string; state?: string; type?: string }

/** מספר ישראלי נייד -> 05X-XXX-XXXX. אחרת מחזיר כמו שהוא. */
function fmtPhone(p: string): string {
  const d = (p || "").replace(/\D/g, "").replace(/^972/, "0");
  return /^0\d{9}$/.test(d) ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : (p || "").trim();
}

function authed(req: NextRequest): boolean {
  const secret = process.env.TABIT_SYNC_SECRET;
  if (!secret) return false;
  const given = req.headers.get("x-tabit-sync-secret") || new URL(req.url).searchParams.get("key") || "";
  return safeTokenEqual(secret, given);
}

function line(r: Row): string {
  const tbl = r.tables && r.tables.length ? r.tables.join("+") : "?";
  const ph = r.phone ? fmtPhone(r.phone) : "-";
  return `${r.name || "(ללא שם)"} · שולחן ${tbl} · ${ph}`;
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const day = url.searchParams.get("day") || "today";
  const dayLabel = day === "today" ? "היום" : day === "tomorrow" ? "מחר" : day;

  let rows: Row[] = [];
  let source = "live";
  try {
    const res = (await runCommand("read_day", { day }, 40000)) as { reservations?: Row[] };
    rows = res.reservations || [];
  } catch {
    source = "snapshot";
    const wantDay =
      day === "today"
        ? dayFmt.format(new Date())
        : day === "tomorrow"
        ? dayFmt.format(new Date(Date.now() + 86400000))
        : day;
    const raw = await getRepo().getSetting("tabit_snapshot");
    const snap = raw ? (JSON.parse(raw) as { reservations?: Row[] }) : null;
    rows = (snap?.reservations || []).filter((r) => r.day === wantDay);
  }

  const list = rows
    .filter((r) => r.state !== "cancelled" && r.type !== "walked_in")
    .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));

  const text =
    `*רשימת אורחים - ${dayLabel}*\n\n` +
    (list.length ? list.map(line).join("\n") : "אין הזמנות") +
    `\n\nסה״כ ${list.length} הזמנות · תוסיפו מזדמנים`;

  return NextResponse.json(
    { text, count: list.length, day, source, generatedAt: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } }
  );
}
