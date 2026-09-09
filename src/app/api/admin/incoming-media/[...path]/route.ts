/**
 * הגשת קבצים שלקוחות שלחו, מאחסון Blob פרטי.
 *
 * למה צריך את זה: מאז 9.9 קבצים נכנסים נשמרים כפרטיים (קבלות וחשבוניות של
 * לקוחות), ולכן אי אפשר להצביע עליהם ישירות מתגית img. הראוט הזה שולף את
 * הקובץ בצד השרת ומזרים אותו לפאנל.
 *
 * אימות: הדפדפן לא יכול לצרף כותרת x-admin-token לתגית img, ולכן ההרשאה כאן
 * נשענת על **עוגיית ההתחברות** - בדיוק כמו שער האתר ב-middleware. הבדיקה
 * חוזרת גם כאן (עומק הגנה), שלא נסתמך רק על כך שהנתיב נמצא מתחת ל-/api/admin.
 */

import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionValue } from "@/lib/session";
import { verifyTeamToken } from "@/lib/team";

export const runtime = "nodejs";

async function authorized(req: NextRequest): Promise<boolean> {
  const secret = process.env.ADMIN_TOKEN;
  // פיתוח מקומי בלי טוקן - פתוח; בפרודקשן בלי טוקן - נעול (fail closed)
  if (!secret) return process.env.NODE_ENV !== "production" && !process.env.VERCEL_ENV;
  const session = await verifySessionValue(req.cookies.get(SESSION_COOKIE)?.value, secret);
  if (!session) return false;
  if (session.r === "master") return true;
  // איש צוות שהוסר מהמערכת מאבד גישה מיד, גם אם העוגייה שלו עוד תקפה
  return !!session.tm && (await verifyTeamToken(session.tm)) !== null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { path } = await params;
  const pathname = (path ?? []).join("/");
  // הנתיב מגיע ממה שאנחנו עצמנו שמרנו, אבל בודקים בכל זאת: רק תיקיית incoming,
  // ובלי חריגה למעלה. מונע שימוש בראוט כדי לשלוף קבצים אחרים מה-store.
  if (!pathname.startsWith("incoming/") || pathname.includes("..")) {
    return NextResponse.json({ error: "bad path" }, { status: 400 });
  }

  try {
    const { get } = await import("@vercel/blob");
    const result = await get(pathname, { access: "private" });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });

    return new NextResponse(result.stream, {
      headers: {
        "Content-Type": result.blob.contentType || "application/octet-stream",
        // private: מותר לדפדפן של הנציג לשמור במטמון, אסור לכל מטמון משותף
        "Cache-Control": "private, max-age=3600",
        // הקובץ מגיע מלקוח - חוסמים הרצה של תוכן שהוגש בטעות כ-HTML
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'",
      },
    });
  } catch (err) {
    console.error("[incoming-media] שליפת קובץ פרטי נכשלה:", err);
    return NextResponse.json({ error: "fetch failed" }, { status: 502 });
  }
}
