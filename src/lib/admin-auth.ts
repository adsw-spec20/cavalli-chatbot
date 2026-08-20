/**
 * שער גישה לפאנל הניהול.
 * נדרשת כותרת x-admin-token התואמת ל-ADMIN_TOKEN מהסביבה.
 *
 * אבטחה:
 * - ההשוואה היא constant-time (timingSafeEqual) למניעת timing attacks.
 * - אם ADMIN_TOKEN לא מוגדר: בפיתוח מקומי הגישה פתוחה (נוחות), אבל
 *   בפרודקשן (Vercel / NODE_ENV=production) הגישה נחסמת - fail closed,
 *   כדי ששכחת משתנה סביבה לא תשאיר את הפאנל פרוץ.
 */

import { timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";

function isProduction(): boolean {
  return process.env.NODE_ENV === "production" || !!process.env.VERCEL_ENV;
}

/** השוואת מחרוזות בזמן קבוע (בטוח גם באורכים שונים). */
export function safeTokenEqual(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** האם הבקשה הגיעה עם טוקן המנהל הראשי (ADMIN_TOKEN). */
export function isMasterAuthorized(req: NextRequest): boolean {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return !isProduction();
  return safeTokenEqual(token, req.headers.get("x-admin-token") ?? "");
}

/**
 * הרשאה כללית לפאנל: טוקן המנהל, או טוקן צוות תקף (כניסה בשם+קוד).
 * async כי אימות טוקן צוות דורש קריאת רשימת הצוות מה-DB - וזה מה שמאפשר
 * ביטול גישה מיידי (מחיקת איש צוות פוסלת את הטוקן שלו).
 */
export async function isAdminAuthorized(req: NextRequest): Promise<boolean> {
  if (isMasterAuthorized(req)) return true;
  const given = req.headers.get("x-admin-token") ?? "";
  if (!given.startsWith("tm.")) return false;
  const { verifyTeamToken } = await import("./team");
  return (await verifyTeamToken(given)) !== null;
}

/** מי מחובר: מנהל, איש צוות (עם שם), או לא מורשה. */
export async function getAuthInfo(
  req: NextRequest
): Promise<{ role: "master" | "agent"; name?: string } | null> {
  if (isMasterAuthorized(req)) return { role: "master" };
  const given = req.headers.get("x-admin-token") ?? "";
  if (!given.startsWith("tm.")) return null;
  const { verifyTeamToken } = await import("./team");
  const member = await verifyTeamToken(given);
  return member ? { role: "agent", name: member.name } : null;
}

export function adminAuthRequired(): boolean {
  return !!process.env.ADMIN_TOKEN;
}
