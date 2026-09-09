/**
 * לקוח Green API לשליחת הודעות וואטסאפ (בוט הקבוצה, משטח B).
 *
 * Green API הוא שער וואטסאפ לא-רשמי (התומך בקבוצות, בניגוד ל-API הרשמי של מטא).
 * מוגדר בסביבה: GREEN_API_ID_INSTANCE, GREEN_API_TOKEN_INSTANCE, ואופציונלית
 * GREEN_API_BASE. אם לא מוגדר - הפונקציות זורקות, והקוראים מטפלים בעדינות.
 * בשלב זה המספר עוד לא מחובר; זו התשתית בלבד.
 */

const BASE = (process.env.GREEN_API_BASE || "https://api.green-api.com").replace(/\/$/, "");
const ID = process.env.GREEN_API_ID_INSTANCE || "";
const TOKEN = process.env.GREEN_API_TOKEN_INSTANCE || "";

export function greenApiConfigured(): boolean {
  return !!(ID && TOKEN);
}

async function call(method: string, payload: unknown): Promise<{ ok: boolean; status: number; body: unknown }> {
  if (!greenApiConfigured()) throw new Error("Green API not configured (GREEN_API_ID_INSTANCE / GREEN_API_TOKEN_INSTANCE)");
  const res = await fetch(`${BASE}/waInstance${ID}/${method}/${TOKEN}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* ignore */
  }
  return { ok: res.ok, status: res.status, body };
}

/** שולח הודעת טקסט לצ'אט (קבוצה או 1:1). chatId בפורמט Green API (…@g.us / …@c.us). */
export async function sendGreenMessage(chatId: string, message: string) {
  return call("sendMessage", { chatId, message });
}

/** שולח תמונה לפי URL (למשל גרף עומס מ-QuickChart). */
export async function sendGreenImageByUrl(chatId: string, urlFile: string, caption?: string, fileName = "chart.png") {
  return call("sendFileByUrl", { chatId, urlFile, fileName, caption });
}
