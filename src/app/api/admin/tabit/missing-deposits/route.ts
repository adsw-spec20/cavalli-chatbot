import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthorized } from "@/lib/admin-auth";
import { getRepo } from "@/lib/db";

/**
 * רשימת ההזמנות שחסר בהן פיקדון (לכפתור "פיקדון" בתיבת הפניות) - **נגיש לצוות**,
 * לא רק מנהל, כי המארחות הן ששולחות את התזכורות. מחזיר רק את מה שצריך לשליחה:
 * שם, טלפון, יום, שעה, סועדים, וקישור הפיקדון של אותה הזמנה. נמשך מה-snapshot
 * (מתעדכן כל 5 דק' מהגשר) - בלי סבב חי ובלי לחשוף את שאר נתוני טאביט.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const todayIL = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });

interface SnapRes {
  id?: string;
  name?: string;
  phone?: string;
  seats?: number;
  day?: string | null;
  time?: string;
  deposit?: string;
  depositLink?: string | null;
}

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const raw = await getRepo().getSetting("tabit_snapshot");
  let snap: { generatedAt?: number; reservations?: SnapRes[] } | null = null;
  try {
    snap = raw ? JSON.parse(raw) : null;
  } catch {
    snap = null;
  }
  const today = todayIL();
  const reservations = (snap?.reservations || [])
    .filter((r) => r.deposit === "missing" && r.day && r.day >= today)
    .map((r) => ({
      id: r.id || "",
      name: r.name || "",
      phone: r.phone || "",
      day: r.day as string,
      time: r.time || "",
      seats: r.seats || 0,
      depositLink: r.depositLink || null,
    }))
    .sort((a, b) => (a.day + a.time < b.day + b.time ? -1 : 1));

  return NextResponse.json(
    { generatedAt: snap?.generatedAt ?? null, reservations },
    { headers: { "Cache-Control": "no-store" } }
  );
}
