import { NextRequest, NextResponse } from "next/server";
import { safeTokenEqual } from "@/lib/admin-auth";
import { getRepo } from "@/lib/db";
import { runCommand } from "@/lib/tabit-queue";

/**
 * Webhook לסיכום "שולחנות גדולים למחר" - עבור אוטומציה חיצונית (Make).
 * מכונה-אל-מכונה: פטור משער העוגייה (PUBLIC_PATHS), מאומת ב-TABIT_SYNC_SECRET
 * (header x-tabit-sync-secret או query ?key=). מחזיר את ההודעה המוכנה בשדה text.
 *
 * מקור הנתונים: קודם קריאה חיה מהסוכן (טרי); אם הסוכן לא זמין - נפילה ל-snapshot.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // אף פעם לא סטטי/ממוטמן - כל קריאה טרייה
export const maxDuration = 60;

const TZ = "Asia/Jerusalem";
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

interface Row { name: string; seats: number; time: string; day: string; tables: number[]; phone?: string; deposit?: string; state?: string; type?: string }

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
  const tbl = r.tables && r.tables.length ? ` •• ש׳ ${r.tables.join(",")}` : "";
  const ph = r.phone ? ` •• ${fmtPhone(r.phone)}` : "";
  // ✅ פיקדון מובטח · ⚠️ חסר · ריק = אין פיקדון בהזמנה (לא מסמנים ✅ מטעה)
  const dep = r.deposit === "missing" ? " •• ⚠️ חסר פיקדון" : r.deposit === "secured" ? " •• ✅" : "";
  return `*${r.time}* •• ${r.name || "(ללא שם)"} •• ${r.seats} סועדים${tbl}${ph}${dep}`;
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const min = Math.max(1, parseInt(url.searchParams.get("min") || "8", 10) || 8);
  const tomorrow = dayFmt.format(new Date(Date.now() + 86400000));

  // מקור טרי: קריאה חיה מהסוכן. נפילה ל-snapshot אם לא זמין.
  // 40 שניות (הוארך מ-20 ב-6.9): הסוכן המקומי סוקר כל 15 שניות כשהוא בטל,
  // ובלי ההארכה הדייג'סט היה נופל ל-snapshot כמעט בכל פעם.
  let rows: Row[] = [];
  let source = "live";
  try {
    const res = (await runCommand("read_day", { day: "tomorrow" }, 40000)) as { reservations?: Row[] };
    rows = res.reservations || [];
  } catch {
    source = "snapshot";
    const raw = await getRepo().getSetting("tabit_snapshot");
    const snap = raw ? (JSON.parse(raw) as { reservations?: Row[] }) : null;
    rows = (snap?.reservations || []).filter((r) => r.day === tomorrow);
  }

  const big = rows
    .filter((r) => r.state !== "cancelled" && r.type !== "walked_in")
    .filter((r) => (r.seats || 0) >= min)
    .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));

  const morning = big.filter((r) => r.time < "18:00");
  const evening = big.filter((r) => r.time >= "18:00");

  const missingCount = big.filter((r) => r.deposit === "missing").length;
  const text =
    `*שולחנות גדולים למחר* (${min}+ סועדים)\n\n` +
    `*🌅 בוקר*\n${morning.length ? morning.map(line).join("\n") : "—"}\n\n` +
    `*🌆 ערב*\n${evening.length ? evening.map(line).join("\n") : "—"}\n\n` +
    `סה״כ ${big.length} שולחנות גדולים${missingCount ? ` •• ⚠️ ${missingCount} חסרי פיקדון` : ""}`;

  return NextResponse.json(
    {
      text,
      date: tomorrow,
      min,
      total: big.length,
      morning: morning.length,
      evening: evening.length,
      source, // "live" = נקרא חי מהסוכן ברגע זה | "snapshot" = הסוכן לא ענה, נתונים אחרונים
      generatedAt: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } }
  );
}
