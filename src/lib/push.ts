/**
 * התראות פוש לצוות (Web Push עם VAPID).
 *
 * כל מכשיר של איש צוות שהדליק את הפעמון בהגדרות נרשם כאן (settings
 * "push_subscriptions"). כשקורה אירוע שדורש תשומת לב (הסלמה, הזמנה חדשה,
 * אזעקת מערכת) - נשלחת התראה לכל המכשירים הרשומים, ישירות דרך שרתי
 * הפוש של אפל/גוגל. עובד גם כשהאפליקציה סגורה והטלפון נעול. עלות: אפס.
 *
 * מנויים מתים (אפליקציה נמחקה מהמכשיר, מנוי שפג) מוסרים אוטומטית כששליחה
 * אליהם מחזירה 404/410. מוגבל ל-50 מכשירים (הגנת ניפוח).
 *
 * מופעל רק אם VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY מוגדרים בסביבה -
 * בלעדיהם הכל no-op שקט (בטוח לפריסה בכל מצב, כמו שאר ההתראות).
 */

import webpush from "web-push";
import { getRepo } from "./db";

const KEY = "push_subscriptions";
const MAX_SUBSCRIPTIONS = 50;

export interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  /** שם איש הצוות שהדליק (לתצוגה בפאנל) */
  name?: string;
  createdAt: number;
}

export function pushConfigured(): boolean {
  return !!process.env.VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY;
}

export function vapidPublicKey(): string {
  return process.env.VAPID_PUBLIC_KEY ?? "";
}

let vapidReady = false;
function ensureVapid(): boolean {
  if (!pushConfigured()) return false;
  if (!vapidReady) {
    webpush.setVapidDetails(
      "mailto:zbangush@gmail.com",
      process.env.VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!
    );
    vapidReady = true;
  }
  return true;
}

export async function loadSubscriptions(): Promise<PushSubscriptionRecord[]> {
  try {
    const raw = await getRepo().getSetting(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function saveSubscriptions(subs: PushSubscriptionRecord[]): Promise<void> {
  await getRepo().setSetting(KEY, JSON.stringify(subs));
}

/** רישום מכשיר (או עדכון אם ה-endpoint כבר קיים). */
export async function addSubscription(rec: PushSubscriptionRecord): Promise<number> {
  const subs = await loadSubscriptions();
  const next = subs.filter((s) => s.endpoint !== rec.endpoint);
  next.push(rec);
  await saveSubscriptions(next.slice(-MAX_SUBSCRIPTIONS));
  return next.length;
}

/** הסרת מכשיר לפי endpoint. */
export async function removeSubscription(endpoint: string): Promise<number> {
  const subs = await loadSubscriptions();
  const next = subs.filter((s) => s.endpoint !== endpoint);
  if (next.length !== subs.length) await saveSubscriptions(next);
  return next.length;
}

export interface TeamPushArgs {
  title: string;
  body: string;
  /** לאן לוחצים מגיעים (ברירת מחדל: הפאנל) */
  url?: string;
  /** התראות עם אותו tag מתאחדות במכשיר */
  tag?: string;
  /** רק למכשיר אחד ספציפי (לבדיקת "שלח ניסיון") */
  onlyEndpoint?: string;
}

/**
 * שליחת התראה לכל מכשירי הצוות הרשומים. שקט בכשל - התראה היא לא סיבה
 * להפיל את זרימת הבוט. מחזיר כמה נשלחו בהצלחה.
 */
export async function sendTeamPush(args: TeamPushArgs): Promise<number> {
  if (!ensureVapid()) return 0;
  let subs = await loadSubscriptions();
  if (args.onlyEndpoint) subs = subs.filter((s) => s.endpoint === args.onlyEndpoint);
  if (!subs.length) return 0;

  const payload = JSON.stringify({
    title: args.title,
    body: args.body,
    url: args.url || "/admin",
    tag: args.tag,
  });

  const dead: string[] = [];
  const results = await Promise.allSettled(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: s.keys },
          payload,
          { TTL: 3600, urgency: "high" }
        );
        return true;
      } catch (err) {
        const status = (err as { statusCode?: number })?.statusCode;
        // 404/410 = המנוי כבר לא קיים (אפליקציה נמחקה) - מסירים מהרשימה
        if (status === 404 || status === 410) dead.push(s.endpoint);
        else console.error("[push] שליחה נכשלה:", status ?? err);
        return false;
      }
    })
  );

  if (dead.length) {
    const remaining = (await loadSubscriptions()).filter((s) => !dead.includes(s.endpoint));
    await saveSubscriptions(remaining).catch(() => undefined);
  }

  return results.filter((r) => r.status === "fulfilled" && r.value === true).length;
}
