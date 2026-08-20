import { NextRequest, NextResponse } from "next/server";
import { teamLogin } from "@/lib/team";

export const runtime = "nodejs";

// הגנת brute-force בסיסית: עד 10 ניסיונות כניסה לדקה מכל IP (best-effort פר-instance)
const attempts = new Map<string, number[]>();
function allowed(ip: string): boolean {
  const now = Date.now();
  const list = (attempts.get(ip) ?? []).filter((t) => now - t < 60_000);
  list.push(now);
  attempts.set(ip, list);
  if (attempts.size > 2000) attempts.clear();
  return list.length <= 10;
}

/** כניסת איש צוות: שם + קוד אישי -> טוקן צוות. */
export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  if (!allowed(ip)) {
    return NextResponse.json({ error: "יותר מדי ניסיונות, נסו שוב בעוד דקה" }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name : "";
  const code = typeof body.code === "string" ? body.code : "";
  if (!name.trim() || !code.trim()) {
    return NextResponse.json({ error: "שם וקוד נדרשים" }, { status: 400 });
  }

  const result = await teamLogin(name, code);
  if (result === "locked") {
    return NextResponse.json(
      { error: "החשבון ננעל זמנית עקב ניסיונות כושלים. נסו שוב בעוד רבע שעה." },
      { status: 429 }
    );
  }
  if (!result) {
    return NextResponse.json({ error: "שם או סיסמה שגויים" }, { status: 401 });
  }
  return NextResponse.json({ token: result.token, name: result.name, role: "agent" });
}
