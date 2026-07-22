/**
 * אימות חתימת webhook של Meta (X-Hub-Signature-256).
 * מוודא שההודעה באמת הגיעה מ-Meta ולא מזויפת. דרוש APP_SECRET של האפליקציה.
 *
 * אם APP_SECRET לא מוגדר: בפיתוח מדלגים (נוחות בדיקות), אבל בפרודקשן דוחים
 * (fail closed) - אחרת שכחת משתנה סביבה מאפשרת זיוף הודעות נכנסות, הרצת
 * קריאות מודל על חשבוננו ושליחת הודעות יזומות ללקוחות.
 */

import crypto from "crypto";

export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null
): boolean {
  const secret = process.env.META_APP_SECRET;
  if (!secret) {
    const prod = process.env.NODE_ENV === "production" || !!process.env.VERCEL_ENV;
    if (prod) console.error("[meta-signature] META_APP_SECRET missing in production - rejecting webhook");
    return !prod;
  }
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
