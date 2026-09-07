import { api } from "./types";

/** המרת מפתח VAPID ציבורי לפורמט ש-subscribe דורש. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * רישום-מחדש שקט של Web Push לשרת (self-heal).
 *
 * הבעיה שזה פותר: iOS ודפדפנים פוסלים subscription אחרי חוסר-פעילות, השרת
 * גוזם אותו ב-410, וההתראות מפסיקות בשקט - בעוד המכשיר עדיין מציג "מופעל".
 * הפתרון: בכל פתיחת אפליקציה (וכשחוזרים אליה) מסנכרנים את המנוי הנוכחי חזרה
 * לשרת. אם הוא נגזם - הוא נרשם מחדש; אם הדפדפן החליף אותו - נשלח החדש. הכל
 * בלי לבקש הרשאה (רק כשההרשאה כבר ניתנה) ובלי שהמשתמש צריך לגעת בכלום.
 */
export async function resyncPush(token: string): Promise<void> {
  try {
    if (!token) return;
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      typeof Notification === "undefined"
    ) {
      return;
    }
    // אף פעם לא מבקשים הרשאה בשקט - רק מרעננים אם היא כבר ניתנה
    if (Notification.permission !== "granted") return;

    const reg =
      (await navigator.serviceWorker.getRegistration("/sw.js")) ||
      (await navigator.serviceWorker.register("/sw.js"));
    await navigator.serviceWorker.ready;

    const info = await api<{ configured: boolean; publicKey: string }>(token, "/push").catch(() => null);
    if (!info || !info.configured || !info.publicKey) return;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(info.publicKey),
      });
    }

    // תמיד לסנכרן לשרת - זה מה שמרפא מנוי שנגזם (השרת מעדכן לפי endpoint, בלי כפילות)
    const name = (typeof localStorage !== "undefined" && localStorage.getItem("agent_name")) || undefined;
    await api(token, "/push", {
      method: "POST",
      body: JSON.stringify({ subscription: sub.toJSON(), name: name || undefined }),
    });
  } catch {
    /* שקט לחלוטין - זו רשת ביטחון, לא סיבה להפיל את הפאנל */
  }
}
