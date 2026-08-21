/**
 * חיבור לשער החניה (PalGate) - פתיחת השער מרחוק עבור לקוחות שמבקשים בצ'אט.
 *
 * מבוסס על ה-API הלא-רשמי של PalGate (אותו פרוטוקול שמשמש את אפליקציית PalGate
 * עצמה ואת אינטגרציות הבית החכם). ההתחברות נעשית פעם אחת דרך "Linked Device"
 * (סריקת QR באפליקציה, ראה scripts/palgate-link.mjs) שמפיקה session token קבוע.
 * מכל בקשה נגזר token זמני (תקף ~5 שניות בלבד) שנשלח בכותרת x-bt-token.
 *
 * אלגוריתם ה-token מבוסס על homebridge-palgate (רישיון MIT), ממומש כאן מחדש
 * עם crypto המובנה של Node (AES-128-ECB) - בלי תלות חיצונית. תודה/קרדיט:
 * https://github.com/Knilo/homebridge-palgate (MIT).
 *
 * משתני סביבה (כולם חובה כדי שהחיבור ייחשב מוגדר):
 *   PALGATE_SESSION_TOKEN - ה-session token מקישור המכשיר (32 תווי hex)
 *   PALGATE_PHONE         - מספר הטלפון של החשבון כמספר בינלאומי (למשל 972500000000)
 *   PALGATE_TOKEN_TYPE    - סוג הקישור שהוחזר בקישור המכשיר: 0=SMS, 1=ראשי, 2=משני
 *   PALGATE_DEVICE_ID     - מזהה השער מרשימת השערים (אפשר "baseId" או "baseId:outputNum")
 * אופציונלי:
 *   PALGATE_API_BASE_URL  - עקיפת כתובת ה-API (ברירת מחדל: הענן של PalGate)
 *   PALGATE_DRY_RUN=1     - לא פותח שער אמיתי; מדמה הצלחה (לבדיקות)
 */

import { createCipheriv, createDecipheriv } from "node:crypto";

const BASE_URL = process.env.PALGATE_API_BASE_URL || "https://api1.pal-es.com/v1/bt/";
// מפתח קבוע מתוך אפליקציית PalGate; הבתים [6..11] נדרסים במספר הטלפון בזמן ריצה.
const T_C_KEY = Buffer.from("fad3257281290000000000003ab45a65", "hex");
const TIMESTAMP_OFFSET = 2;

type TokenType = 0 | 1 | 2; // 0=SMS, 1=PRIMARY, 2=SECONDARY

/** האם חיבור PalGate מוגדר? (קובע אם כלי השער בכלל מוצג למודל) */
export function isGateConfigured(): boolean {
  return Boolean(
    process.env.PALGATE_SESSION_TOKEN &&
      process.env.PALGATE_PHONE &&
      process.env.PALGATE_TOKEN_TYPE !== undefined &&
      process.env.PALGATE_DEVICE_ID
  );
}

/**
 * האם לעקוף זמנית את בדיקת שעות הפעילות של השער?
 * מיועד אך ורק לתקופת ההקמה / בדיקה פיזית מול השער (כולל בסופ"ש כשהעסק סגור).
 * ⚠️ כשזה דלוק, השער נפתח לכל בקשה גם מחוץ לשעות הפעילות - לכבות אחרי הבדיקות!
 * להסרה: מוחקים/מכבים את PALGATE_IGNORE_HOURS ומפרסים מחדש.
 */
export function gateHoursBypassed(): boolean {
  return process.env.PALGATE_IGNORE_HOURS === "1";
}

function encBlock(block: Buffer, key: Buffer): Buffer {
  const c = createCipheriv("aes-128-ecb", key, null);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(block), c.final()]);
}

function decBlock(block: Buffer, key: Buffer): Buffer {
  const d = createDecipheriv("aes-128-ecb", key, null);
  d.setAutoPadding(false);
  return Buffer.concat([d.update(block), d.final()]);
}

function packU64BE(n: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n));
  return b;
}

/**
 * מייצר token זמני (46 תווי hex) לבקשה בודדת. חייב להיווצר מחדש בכל קריאה -
 * הוא תקף לכ-5 שניות בלבד. חושף גם לבדיקות (וקטורי בדיקה ידועים ב-palgate.ts).
 */
export function generateToken(
  sessionToken: Buffer,
  phone: number,
  type: TokenType,
  unixSeconds: number = Math.floor(Date.now() / 1000)
): string {
  if (sessionToken.length !== 16) throw new Error("session token חייב להיות 16 בתים (32 hex)");
  const phoneBytes = packU64BE(phone);

  // שלב 1: גזירת מפתח - המפתח הקבוע עם הטלפון (בתים 2..7) בתוך בתים 6..11, ואז
  // פענוח AES של ה-session token עם המפתח הזה (כן, decrypt - כך במקור).
  const key = Buffer.from(T_C_KEY);
  phoneBytes.copy(key, 6, 2, 8);
  const step1 = decBlock(sessionToken, key);

  // שלב 2: בלוק עם חותמת הזמן, ואז הצפנת AES עם התוצאה של שלב 1 כמפתח.
  const ns = Buffer.alloc(16);
  ns.writeUInt16LE(0x0a0a, 1);
  ns.writeUInt32BE((unixSeconds + TIMESTAMP_OFFSET) >>> 0, 10);
  const step2 = encBlock(ns, step1);

  // הרכבה: בית סוג + 6 בתי טלפון + 16 בתי שלב 2.
  const out = Buffer.alloc(23);
  out[0] = type === 0 ? 0x01 : type === 1 ? 0x11 : 0x21;
  phoneBytes.copy(out, 1, 2, 8);
  step2.copy(out, 7);
  return out.toString("hex").toUpperCase();
}

/** מפצל מזהה שער ל-baseId ומספר פלט (ברירת מחדל פלט 1; "baseId:2" -> פלט 2). */
function splitDeviceId(deviceId: string): { baseId: string; outputNum: number } {
  if (deviceId.includes(":")) {
    const parts = deviceId.split(":");
    const num = parseInt(parts.pop() as string, 10);
    if (Number.isFinite(num) && num > 0) return { baseId: parts.join(":"), outputNum: num };
  }
  return { baseId: deviceId, outputNum: 1 };
}

function currentTemporalToken(): string {
  const sessionHex = process.env.PALGATE_SESSION_TOKEN as string;
  const phone = Number(process.env.PALGATE_PHONE);
  const type = Number(process.env.PALGATE_TOKEN_TYPE) as TokenType;
  return generateToken(Buffer.from(sessionHex, "hex"), phone, type);
}

/** קריאת GET ל-API של PalGate עם ה-token הזמני בכותרת. זורק על שגיאת רשת/HTTP. */
async function callApi(endpoint: string): Promise<unknown> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(BASE_URL + endpoint, {
      method: "GET",
      headers: {
        "x-bt-token": currentTemporalToken(),
        Accept: "*/*",
        "Accept-Language": "en-us",
        "Content-Type": "application/json",
        // מתחזה לאפליקציית האנדרואיד, למקרה של סינון לפי User-Agent
        "User-Agent": "okhttp/4.9.3",
      },
      signal: controller.signal,
    });
    const body = await res.text();
    if (!res.ok) {
      throw new Error(`PalGate HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  } finally {
    clearTimeout(t);
  }
}

/**
 * פותח את שער החניה. זורק שגיאה אם הפתיחה נכשלה (הקורא מטפל בהסלמה ללקוח).
 */
export async function openParkingGate(): Promise<void> {
  if (!isGateConfigured()) throw new Error("PalGate לא מוגדר (חסרים משתני סביבה)");

  // מצב יבש לבדיקות: לא נוגעים בשער אמיתי.
  if (process.env.PALGATE_DRY_RUN === "1") {
    console.log("[PalGate] DRY_RUN - מדמה פתיחת שער בלי קריאה אמיתית");
    return;
  }

  const { baseId, outputNum } = splitDeviceId(process.env.PALGATE_DEVICE_ID as string);
  // open-gate היא GET ולא אידמפוטנטית (retry עלול לפתוח פעמיים) - לכן בלי ניסיונות חוזרים.
  const result = (await callApi(
    `device/${encodeURIComponent(baseId)}/open-gate?outputNum=${outputNum}`
  )) as { err?: unknown; msg?: string; status?: unknown } | string;

  // הענן מחזיר JSON עם שדה err כשיש בעיה (למשל token פג או אין הרשאה).
  if (result && typeof result === "object" && "err" in result && result.err) {
    throw new Error(`PalGate דחה את הפתיחה: ${result.msg ?? JSON.stringify(result).slice(0, 200)}`);
  }
}
