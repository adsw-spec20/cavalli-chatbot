import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthorized } from "@/lib/admin-auth";
import {
  addSubscription,
  pushConfigured,
  removeSubscription,
  sendTeamPush,
  vapidPublicKey,
} from "@/lib/push";

export const runtime = "nodejs";

// ניהול התראות פוש: כל איש צוות מחובר יכול לרשום/להסיר את המכשיר שלו
// ולשלוח לעצמו התראת ניסיון. מוגן כמו שאר הפאנל (טוקן + עוגיית השער).

const unauthorized = () => NextResponse.json({ error: "unauthorized" }, { status: 401 });

/** המפתח הציבורי שהדפדפן צריך בשביל להירשם. */
export async function GET(req: NextRequest) {
  if (!(await isAdminAuthorized(req))) return unauthorized();
  return NextResponse.json({ configured: pushConfigured(), publicKey: vapidPublicKey() });
}

/**
 * רישום מכשיר: { subscription, name } או התראת ניסיון: { test: true, endpoint }.
 */
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthorized(req))) return unauthorized();
  if (!pushConfigured()) {
    return NextResponse.json({ error: "התראות פוש לא מוגדרות בשרת" }, { status: 503 });
  }
  const body = await req.json().catch(() => ({}));

  // --- התראת ניסיון למכשיר הזה בלבד ---
  if (body.test === true) {
    const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
    if (!endpoint) return NextResponse.json({ error: "endpoint required" }, { status: 400 });
    const sent = await sendTeamPush({
      title: "🔔 בדיקת התראות - קפה קוואלי",
      body: "אם קיבלת את זה, ההתראות במכשיר הזה עובדות מצוין!",
      tag: "push-test",
      onlyEndpoint: endpoint,
    });
    return NextResponse.json({ sent });
  }

  // --- רישום מכשיר ---
  const sub = body.subscription;
  if (
    !sub ||
    typeof sub.endpoint !== "string" ||
    !sub.endpoint.startsWith("https://") ||
    typeof sub.keys?.p256dh !== "string" ||
    typeof sub.keys?.auth !== "string"
  ) {
    return NextResponse.json({ error: "subscription לא תקין" }, { status: 400 });
  }
  const count = await addSubscription({
    endpoint: sub.endpoint,
    keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    name: typeof body.name === "string" ? body.name.slice(0, 40) : undefined,
    createdAt: Date.now(),
  });
  return NextResponse.json({ ok: true, count });
}

/** הסרת מכשיר: ?endpoint= (מקודד). */
export async function DELETE(req: NextRequest) {
  if (!(await isAdminAuthorized(req))) return unauthorized();
  const endpoint = req.nextUrl.searchParams.get("endpoint");
  if (!endpoint) return NextResponse.json({ error: "endpoint required" }, { status: 400 });
  const count = await removeSubscription(endpoint);
  return NextResponse.json({ ok: true, count });
}
