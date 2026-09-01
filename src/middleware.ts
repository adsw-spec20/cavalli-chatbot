/**
 * שער הכניסה של כל האתר - רץ על כל בקשה לפני שהיא מגיעה לדף/API.
 *
 * ברירת המחדל: הכל נעול. מי שאין לו עוגיית התחברות חתומה ותקפה מופנה
 * למסך הכניסה (/login), ובקשות API נחסמות עם 401.
 *
 * חריגים מפורשים בלבד (כל אחד עם הצדקה):
 * - /api/webhooks/*  - מטא (וואטסאפ/מסנג'ר/אינסטגרם) קוראת לכאן; מאומת
 *                      בנפרד עם חתימת META_APP_SECRET וטוקן verify.
 * - /api/cron/*      - Vercel Cron; מאומת בנפרד עם CRON_SECRET.
 * - /api/admin/login + /logout - חייבים להיות נגישים כדי להתחבר בכלל.
 *                      (יש שם הגנת brute-force + נעילת חשבון.)
 * - /api/admin/media/upload - הדפדפן מאמת בתוכו עם טוקן, ושרתי Vercel Blob
 *                      קוראים אליו חזרה עם חתימה משלהם (בלי עוגייה).
 * - /privacy, /data-deletion - דרישת מטא: חייבים להיות ציבוריים לאישור האפליקציה.
 * - /login, manifest, אייקונים - מסך הכניסה עצמו וה-PWA.
 *
 * שכבת ההגנה הזו היא בנוסף (לא במקום) לאימות הטוקן שכבר קיים בכל
 * route של הפאנל - עומק הגנה: גם אם שכחנו אימות ב-route חדש, השער כאן חוסם.
 */

import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionValue } from "@/lib/session";

// נתיבים פתוחים: ערך שמסתיים ב-"/" הוא קידומת, אחרת התאמה מדויקת
const PUBLIC_PATHS = [
  "/api/webhooks/",
  "/api/cron/",
  "/api/admin/login",
  "/api/admin/logout",
  "/api/admin/media/upload",
  // הגשר של טאביט (סקריפט מקומי, בלי עוגייה) שולח לכאן snapshot; מאומת
  // בנפרד עם TABIT_SYNC_SECRET בתוך ה-route. הגשה למנהל (/api/admin/tabit)
  // נשארת מאחורי השער - רק הקליטה פתוחה.
  "/api/admin/tabit/ingest",
  // הסוכן המקומי של מעבדת טאביט מושך/מחזיר פקודות כאן; מאומת בסוד ב-route.
  "/api/admin/tabit/agent",
  "/login",
  "/privacy",
  "/data-deletion",
  "/admin-manifest.webmanifest",
  "/icons/",
  "/favicon.ico",
  // ה-service worker של התראות הפוש: הדפדפן מוריד/מעדכן אותו גם ברקע,
  // לא בהכרח עם עוגיית התחברות. הקובץ לא חושף שום מידע עסקי.
  "/sw.js",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) =>
    p.endsWith("/") ? pathname.startsWith(p) : pathname === p
  );
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production" || !!process.env.VERCEL_ENV;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const secret = process.env.ADMIN_TOKEN;
  if (!secret) {
    // בפיתוח מקומי בלי טוקן - פתוח (נוחות); בפרודקשן - נעול (fail closed)
    if (!isProduction()) return NextResponse.next();
    return pathname.startsWith("/api/")
      ? NextResponse.json({ error: "unauthorized" }, { status: 401 })
      : NextResponse.redirect(new URL("/login", req.url));
  }

  const session = await verifySessionValue(req.cookies.get(SESSION_COOKIE)?.value, secret);
  if (session) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const login = new URL("/login", req.url);
  // אחרי התחברות חוזרים לאן שניסו להגיע (נתיב יחסי בלבד - נגד open redirect)
  if (pathname !== "/") login.searchParams.set("next", pathname + req.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = {
  // רץ על הכל חוץ מקבצים סטטיים של Next (הם לא חושפים מידע עסקי)
  matcher: ["/((?!_next/static|_next/image).*)"],
};
