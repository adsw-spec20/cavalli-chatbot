/**
 * בקשות הזמנת מקום דרך הבוט.
 *
 * הזרימה: הבוט אוסף פרטים בשיחה (כמה אנשים, מתי, שם, טלפון) וקורא לכלי
 * request_reservation -> נוצר כאן כרטיס "ממתין" -> הצוות רואה בפאנל,
 * בודק מקום בטאביט, ולוחץ "אשר"/"אין מקום" -> הבוט שולח ללקוח את התשובה.
 *
 * חשוב: הבוט לעולם לא מבטיח מקום - רק מעביר בקשה. האישור תמיד אנושי.
 * אחסון: settings key "reservations" (נפח קטן - בית קפה), נשמרות עד 300 אחרונות.
 */

import { randomUUID } from "crypto";
import { getRepo } from "./db";
import { sendAlertEmail, sendTeamWhatsAppAlert, escapeHtml } from "./alerts";

const KEY = "reservations";
const MAX_KEPT = 300;

export type ReservationStatus = "pending" | "approved" | "declined";

export interface Reservation {
  id: string;
  conversationId: string;
  customerId: string;
  channel: string;
  customerName?: string;
  /** פרטי הבקשה כפי שנאספו מהלקוח */
  people: number;
  /** התאריך כפי שהלקוח אמר ("מחר", "יום שישי") - מוצג לצוות כמו שהוא */
  dateText: string;
  /** הערכת התאריך של הבוט בפורמט ISO (הצוות מאמת ממילא) */
  dateISO?: string;
  time: string;
  name: string;
  phone: string;
  notes?: string;
  status: ReservationStatus;
  createdAt: number;
  handledAt?: number;
  handledBy?: string;
}

export async function loadReservations(): Promise<Reservation[]> {
  try {
    const raw = await getRepo().getSetting(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function save(list: Reservation[]): Promise<void> {
  await getRepo().setSetting(KEY, JSON.stringify(list.slice(-MAX_KEPT)));
}

export async function createReservation(
  data: Omit<Reservation, "id" | "status" | "createdAt">
): Promise<Reservation> {
  const list = await loadReservations();
  // מניעת כפילות (הוקשח 20.8 אחרי בקשות כפולות מ"תודה"): כל עוד יש בקשה ממתינה
  // מאותה שיחה - לא פותחים שנייה, גם אם המודל שלח פרטים שונים במקצת.
  // שינוי אמיתי בבקשה קיימת עובר דרך הצוות (כלל 17 - הסלמה), לא דרך כרטיס חדש.
  const dup = list.find((r) => r.status === "pending" && r.conversationId === data.conversationId);
  if (dup) return dup;

  const reservation: Reservation = {
    ...data,
    id: randomUUID(),
    status: "pending",
    createdAt: Date.now(),
  };
  list.push(reservation);
  await save(list);

  // התראה במייל לצוות (לא חוסמת)
  sendAlertEmail(
    `🍽️ בקשת הזמנה חדשה - ${escapeHtml(reservation.name)} (${reservation.people})`,
    `<div style="font-family:sans-serif;direction:rtl">
      <h2>🍽️ בקשת הזמנת מקום חדשה</h2>
      <p><b>שם:</b> ${escapeHtml(reservation.name)} · <b>טלפון:</b> ${escapeHtml(reservation.phone)}</p>
      <p><b>כמה:</b> ${reservation.people} אנשים · <b>מתי:</b> ${escapeHtml(reservation.dateText)}${
        reservation.dateISO ? ` (${escapeHtml(reservation.dateISO)})` : ""
      } בשעה ${escapeHtml(reservation.time)}</p>
      ${reservation.notes ? `<p><b>בקשות מיוחדות:</b> ${escapeHtml(reservation.notes)}</p>` : ""}
      <p>יש לאשר או לדחות מהפאנל - הלקוח יקבל עדכון אוטומטי בצ'אט.</p>
      <p><a href="https://cavalli-chatbot.vercel.app/admin">פתיחת הפאנל</a></p>
    </div>`
  ).catch(() => {});
  // התראת וואטסאפ לצוות (לא חוסמת)
  sendTeamWhatsAppAlert(
    `🍽️ בקשת הזמנה חדשה: ${reservation.people} אנשים, ${reservation.dateText} בשעה ${reservation.time}, ע"ש ${reservation.name}${reservation.notes ? ` (${reservation.notes})` : ""}. לאישור בפאנל`
  ).catch(() => {});

  return reservation;
}

export async function setReservationStatus(
  id: string,
  status: "approved" | "declined",
  handledBy?: string
): Promise<Reservation | null> {
  const list = await loadReservations();
  const r = list.find((x) => x.id === id);
  if (!r) return null;
  r.status = status;
  r.handledAt = Date.now();
  r.handledBy = handledBy;
  await save(list);
  return r;
}

/**
 * מחיקת הזמנות מההיסטוריה (ניקוי הפאנל). מוחק לפי מזהים, או את כל
 * המטופלות (scope="handled") - הזמנות ממתינות לעולם לא נמחקות דרך scope.
 * מחזיר כמה נמחקו.
 */
export async function deleteReservations(opts: { ids?: string[]; scope?: "handled" }): Promise<number> {
  const list = await loadReservations();
  const idSet = new Set(opts.ids ?? []);
  const keep = list.filter((r) => {
    if (idSet.has(r.id)) return false;
    if (opts.scope === "handled" && r.status !== "pending") return false;
    return true;
  });
  if (keep.length !== list.length) await save(keep);
  return list.length - keep.length;
}

export async function countPendingReservations(): Promise<number> {
  return (await loadReservations()).filter((r) => r.status === "pending").length;
}
