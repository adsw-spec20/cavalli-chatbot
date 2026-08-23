/**
 * עוגיית התחברות חתומה - "כרטיס הכניסה" של כל האתר.
 *
 * מונפקת בכניסה מוצלחת (שם+סיסמה של איש צוות, או קוד המנהל הראשי) ונבדקת
 * ב-middleware על כל בקשה. בלי עוגייה תקפה - שום דף ושום API לא נגיש
 * (מלבד רשימת החריגים: webhooks של מטא, cron, עמודי פרטיות).
 *
 * אבטחה:
 * - התוכן חתום HMAC-SHA256 עם מפתח שנגזר מ-ADMIN_TOKEN: אי אפשר לזייף או
 *   לשנות עוגייה בלי הסוד. החלפת ADMIN_TOKEN מבטלת מיד את כל ההתחברויות.
 * - תוקף מוגבל (30 יום) חתום בתוך התוכן עצמו.
 * - העוגייה httpOnly + Secure - JS בדפדפן לא יכול לקרוא אותה, והיא נשלחת
 *   רק ב-HTTPS.
 * - נכתב עם Web Crypto בלבד כדי לרוץ גם ב-middleware (Edge) וגם ב-Node.
 */

export const SESSION_COOKIE = "cavalli_session";
export const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60; // 30 יום

export interface SessionPayload {
  /** master = קוד גישה ראשי; agent = איש צוות */
  r: "master" | "agent";
  /** שם איש הצוות (לתצוגה בלבד) */
  n?: string;
  /** טוקן הצוות הפנימי - מאפשר ל-API לוודא שהאיש עדיין קיים (ביטול גישה) */
  tm?: string;
  /** תפוגה (epoch ms) */
  exp: number;
}

const enc = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array | null {
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(`cavalli-session-v1:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

/** יצירת ערך עוגייה חתום. */
export async function createSessionValue(
  payload: Omit<SessionPayload, "exp">,
  secret: string
): Promise<string> {
  const full: SessionPayload = { ...payload, exp: Date.now() + SESSION_MAX_AGE_S * 1000 };
  const body = b64urlEncode(enc.encode(JSON.stringify(full)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return `s1.${body}.${b64urlEncode(new Uint8Array(sig))}`;
}

/**
 * אימות ערך עוגייה. מחזיר את התוכן אם החתימה תקינה והתוקף לא פג, אחרת null.
 * האימות נעשה עם crypto.subtle.verify (השוואה בזמן קבוע בתוך המימוש).
 */
export async function verifySessionValue(
  value: string | undefined,
  secret: string
): Promise<SessionPayload | null> {
  if (!value || !value.startsWith("s1.")) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [, body, sigB64] = parts;
  const sig = b64urlDecode(sigB64);
  if (!sig) return null;

  const key = await hmacKey(secret);
  const sigBuf = new Uint8Array(sig);
  const ok = await crypto.subtle.verify("HMAC", key, sigBuf, enc.encode(body));
  if (!ok) return null;

  const raw = b64urlDecode(body);
  if (!raw) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(raw)) as SessionPayload;
    if (typeof payload.exp !== "number" || Date.now() > payload.exp) return null;
    if (payload.r !== "master" && payload.r !== "agent") return null;
    return payload;
  } catch {
    return null;
  }
}
