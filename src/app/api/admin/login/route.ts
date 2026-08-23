import { NextRequest, NextResponse } from "next/server";
import { teamLogin } from "@/lib/team";
import { safeTokenEqual } from "@/lib/admin-auth";
import { createSessionValue, SESSION_COOKIE, SESSION_MAX_AGE_S } from "@/lib/session";

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

function isProduction(): boolean {
  return process.env.NODE_ENV === "production" || !!process.env.VERCEL_ENV;
}

/** מצמיד לתשובה את עוגיית ההתחברות החתומה (השער של כל האתר - ראה middleware). */
async function withSessionCookie(
  res: NextResponse,
  payload: { r: "master" | "agent"; n?: string; tm?: string }
): Promise<NextResponse> {
  const secret = process.env.ADMIN_TOKEN;
  if (!secret) return res; // פיתוח מקומי בלי טוקן - אין שער, אין צורך בעוגייה
  const value = await createSessionValue(payload, secret);
  res.cookies.set(SESSION_COOKIE, value, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE_S,
    path: "/",
  });
  return res;
}

/**
 * כניסה למערכת - שני מסלולים:
 * - איש צוות: { name, code } -> טוקן צוות + עוגיית התחברות.
 * - מנהל ראשי: { master } -> אימות מול ADMIN_TOKEN + עוגיית התחברות.
 */
export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  if (!allowed(ip)) {
    return NextResponse.json({ error: "יותר מדי ניסיונות, נסו שוב בעוד דקה" }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));

  // ---- מסלול מנהל ראשי ----
  if (typeof body.master === "string" && body.master.trim()) {
    const expected = process.env.ADMIN_TOKEN;
    if (!expected) {
      // בפרודקשן בלי טוקן מוגדר - נעול (fail closed); בפיתוח - פתוח
      if (isProduction()) {
        return NextResponse.json({ error: "המערכת לא מוגדרת" }, { status: 503 });
      }
      return NextResponse.json({ ok: true, role: "master" });
    }
    if (!safeTokenEqual(expected, body.master.trim())) {
      return NextResponse.json({ error: "קוד גישה שגוי" }, { status: 401 });
    }
    return withSessionCookie(NextResponse.json({ ok: true, role: "master" }), {
      r: "master",
    });
  }

  // ---- מסלול איש צוות: שם + סיסמה ----
  const name = typeof body.name === "string" ? body.name : "";
  const code = typeof body.code === "string" ? body.code : "";
  if (!name.trim() || !code.trim()) {
    return NextResponse.json({ error: "שם וסיסמה נדרשים" }, { status: 400 });
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
  return withSessionCookie(
    NextResponse.json({ token: result.token, name: result.name, role: "agent" }),
    { r: "agent", n: result.name, tm: result.token }
  );
}
