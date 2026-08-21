/**
 * קישור חד-פעמי לשער החניה (PalGate) דרך "Linked Device" - מפיק את משתני הסביבה
 * שהבוט צריך כדי לפתוח את השער.
 *
 * הרצה:  node scripts/palgate-link.mjs
 *
 * מה קורה:
 *  1. הסקריפט מייצר QR ומדפיס אותו בטרמינל.
 *  2. באפליקציית PalGate בטלפון: תפריט > Linked Devices (אנדרואיד) / Device Linking (iOS)
 *     > Link a Device, וסרוק את ה-QR שמופיע כאן.
 *  3. תוך כמה שניות יודפסו כאן הערכים. העתק אותם ל-.env.local (מקומית) ול-Vercel
 *     (Environment Variables) בפרודקשן.
 *
 * דרישות: לחשבון שלך צריכה להיות הרשאת "Linked Device" לשער (יש לך, אתה מנהל השער),
 * ויש מקסימום 2 מכשירים מקושרים - ודא שיש סלוט פנוי.
 *
 * הערה: הסקריפט לא כותב שום קובץ ולא שולח מידע לאף מקום מלבד הענן של PalGate.
 */

import { randomUUID } from "node:crypto";
import qrcode from "qrcode-terminal";

const BASE_URL = process.env.PALGATE_API_BASE_URL || "https://api1.pal-es.com/v1/bt/";
const LINK_TIMEOUT_MS = 90_000;
const POLL_EVERY_MS = 3_000;

const HEADERS = {
  "x-bt-token": "", // בקריאת הקישור הראשונית ה-token ריק בכוונה
  Accept: "*/*",
  "Accept-Language": "en-us",
  "Content-Type": "application/json",
  "User-Agent": "okhttp/4.9.3",
};

async function pollOnce(uuid) {
  const res = await fetch(`${BASE_URL}un/secondary/init/${uuid}`, { headers: HEADERS });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  if (data && data.user && data.secondary !== undefined) {
    return {
      phoneNumber: data.user.id, // מספר הטלפון / מזהה המשתמש
      sessionToken: data.user.token, // 32 תווי hex
      tokenType: data.secondary, // 1=ראשי, 2=משני
    };
  }
  return null;
}

async function main() {
  const uuid = randomUUID();
  const qrData = JSON.stringify({ id: uuid });

  console.log("\n📱 פתח את אפליקציית PalGate > Linked Devices > Link a Device, וסרוק:\n");
  qrcode.generate(qrData, { small: true });
  console.log(`\n(אם הסריקה לא עובדת, תוכן ה-QR הוא: ${qrData})`);
  console.log("\n⏳ ממתין לסריקה (עד 90 שניות)...\n");

  const start = Date.now();
  while (Date.now() - start < LINK_TIMEOUT_MS) {
    let creds = null;
    try {
      creds = await pollOnce(uuid);
    } catch {
      /* רשת - ננסה שוב */
    }
    if (creds) {
      const tokenTypeName = creds.tokenType === 1 ? "ראשי" : creds.tokenType === 2 ? "משני" : "SMS";
      console.log("\n✅ הקישור הצליח! הוסף את הערכים הבאים ל-.env.local ול-Vercel:\n");
      console.log(`PALGATE_SESSION_TOKEN=${creds.sessionToken}`);
      console.log(`PALGATE_PHONE=${creds.phoneNumber}`);
      console.log(`PALGATE_TOKEN_TYPE=${creds.tokenType}   # ${tokenTypeName}`);
      console.log(`PALGATE_DEVICE_ID=<מזהה השער>`);
      console.log(
        "\n➡️  להשלמת PALGATE_DEVICE_ID: הרץ  node scripts/palgate-devices.mjs  (אחרי שתמלא את שלושת הערכים למעלה) כדי לראות את רשימת השערים ולבחור את המזהה הנכון.\n"
      );
      return;
    }
    await new Promise((r) => setTimeout(r, POLL_EVERY_MS));
  }
  console.error("\n❌ פג הזמן בלי סריקה. הרץ שוב את הסקריפט ונסה מחדש.\n");
  process.exit(1);
}

main().catch((err) => {
  console.error("שגיאה:", err);
  process.exit(1);
});
