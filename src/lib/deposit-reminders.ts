/**
 * מעקב "נשלחה תזכורת פיקדון": מזהה הזמנה בטאביט -> מתי נשלחה תזכורת בוואטסאפ.
 *
 * הנקודה: שלא יישלחו שתי תזכורות לאותו לקוח משתי מארחות. המסכים מציגים
 * "נשלחה תזכורת · תאריך ושעה" ליד ההזמנה. נשמר ב-KV כמפה אחת קטנה,
 * ומנוקה מרשומות ישנות (ההזמנה ממילא כבר עברה).
 */

import { getRepo } from "./db";

const KEY = "deposit_reminders_sent";
const MAX_AGE_MS = 45 * 24 * 3600_000;

export async function loadDepositReminders(): Promise<Record<string, number>> {
  try {
    const raw = await getRepo().getSetting(KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    return map && typeof map === "object" ? map : {};
  } catch {
    return {};
  }
}

export async function recordDepositReminder(reservationId: string): Promise<void> {
  if (!reservationId) return;
  const map = await loadDepositReminders();
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const [id, ts] of Object.entries(map)) if (!ts || ts < cutoff) delete map[id];
  map[reservationId] = Date.now();
  await getRepo().setSetting(KEY, JSON.stringify(map));
}
