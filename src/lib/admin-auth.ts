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

export function isAdminAuthorized(req: NextRequest): boolean {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return !isProduction();
  return safeTokenEqual(token, req.headers.get("x-admin-token") ?? "");
}

export function adminAuthRequired(): boolean {
  return !!process.env.ADMIN_TOKEN;
}
