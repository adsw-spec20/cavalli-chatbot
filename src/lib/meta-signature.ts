/**
 * אימות חתימת webhook של Meta (X-Hub-Signature-256).
 * מוודא שההודעה באמת הגיעה מ-Meta ולא מזויפת. דרוש APP_SECRET של האפליקציה.
 * אם APP_SECRET לא מוגדר (פיתוח), מדלגים על האימות.
 */

import crypto from "crypto";

export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null
): boolean {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return true; // פיתוח: ללא אימות
  if (!signatureHeader) return false;

  const expected =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(signatureHeader)
    );
  } catch {
    return false;
  }
}
