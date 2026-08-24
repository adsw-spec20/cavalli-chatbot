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

  // --- התראות ניסיון למכשיר הזה בלבד: דוגמה חיה של כל שלושת התרחישים ---
  if (body.test === true) {
    const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
    if (!endpoint) return NextResponse.json({ error: "endpoint required" }, { status: 400 });
    // אותם כותרות ופורמט כמו ההתראות האמיתיות, עם נתוני דוגמה מזוהים
    // ("ישראל ישראלי") כדי שאפשר יהיה לצלם ולהראות לצוות איך זה נראה
    const samples = [
      {
        title: "🔴 דחוף! שיחה עברה לנציג (וואטסאפ)",
        body: "ישראל ישראלי: הלקוח מבקש לדבר עם נציג לגבי הזמנה לאירוע",
        tag: "test-escalation",
      },
      {
        title: "🍽️ בקשת הזמנה חדשה",
        body: "4 אנשים, יום חמישי בשעה 20:00, ע\"ש ישראל ישראלי",
        tag: "test-reservation",
      },
      {
        title: "🚨 תקלת מערכת - הבוט",
        body: "הודעת ניסיון: ככה תיראה התראה אם הבוט יפסיק לענות ללקוחות",
        tag: "test-alarm",
      },
    ];
    let sent = 0;
    for (const s of samples) {
      sent += await sendTeamPush({ ...s, onlyEndpoint: endpoint });
      // הפוגה קטנה כדי שההתראות יגיעו כשלוש נפרדות ובסדר הנכון
      await new Promise((r) => setTimeout(r, 400));
    }
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
