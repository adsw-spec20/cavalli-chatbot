/**
 * שער גישה פשוט לפאנל הניהול.
 * אם מוגדר ADMIN_TOKEN בסביבה, נדרשת כותרת x-admin-token תואמת.
 * אם לא מוגדר (פיתוח) - הגישה פתוחה. בפרודקשן חובה להגדיר ADMIN_TOKEN.
 */

import type { NextRequest } from "next/server";

export function isAdminAuthorized(req: NextRequest): boolean {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return true;
  return req.headers.get("x-admin-token") === token;
}

export function adminAuthRequired(): boolean {
  return !!process.env.ADMIN_TOKEN;
}
