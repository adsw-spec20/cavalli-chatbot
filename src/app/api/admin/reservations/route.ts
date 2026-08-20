import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthorized, isMasterAuthorized } from "@/lib/admin-auth";
import { loadReservations, setReservationStatus, deleteReservations } from "@/lib/reservations";
import { agentReply } from "@/lib/admin-service";
import { israelDateISO } from "@/lib/business-hours";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const list = await loadReservations();
  // ממתינות קודם (חדשות למעלה), אחר כך מטופלות אחרונות
  const pending = list.filter((r) => r.status === "pending").sort((a, b) => b.createdAt - a.createdAt);
  const handled = list
    .filter((r) => r.status !== "pending")
    .sort((a, b) => (b.handledAt ?? 0) - (a.handledAt ?? 0))
    .slice(0, 30);
  // אג'נדה: הזמנות מאושרות שעוד לפנינו (לפי תאריך ישראל), ממוינות כרונולוגית
  const today = israelDateISO();
  const upcoming = list
    .filter((r) => r.status === "approved" && r.dateISO && r.dateISO >= today)
    .sort((a, b) => a.dateISO!.localeCompare(b.dateISO!) || a.time.localeCompare(b.time));
  return NextResponse.json({ pending, upcoming, handled });
}

/**
 * טיפול בבקשה: { id, action: "approve"|"decline", message?, agentName, silent? }
 * מעדכן סטטוס ושולח ללקוח את ההודעה בערוץ שממנו הגיע (דרך מנגנון תשובת נציג).
 * silent=true: עדכון סטטוס בלבד, בלי לשלוח שום הודעה ללקוח (למשל כשסוגרים
 * מולו בטלפון, או בקשת בדיקה שלא צריכה מענה).
 */
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const { id, action, message, agentName, silent } = body as {
    id?: string;
    action?: string;
    message?: string;
    agentName?: string;
    silent?: boolean;
  };
  if (!id || (action !== "approve" && action !== "decline")) {
    return NextResponse.json({ error: "id + action (approve/decline) required" }, { status: 400 });
  }
  if (!silent && !message?.trim()) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }

  const updated = await setReservationStatus(
    id,
    action === "approve" ? "approved" : "declined",
    agentName
  );
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (silent) return NextResponse.json({ updated });

  // שליחת ההודעה ללקוח בצ'אט (בערוצים אמיתיים נשלחת בפועל; ב-playground רק נשמרת)
  try {
    await agentReply(updated.conversationId, message!.trim(), agentName || "הצוות");
  } catch (err) {
    console.error("[reservations] שליחת הודעה ללקוח נכשלה:", err);
    return NextResponse.json(
      { updated, warning: "הסטטוס עודכן אבל שליחת ההודעה ללקוח נכשלה - כדאי לנסות מהשיחה עצמה" },
      { status: 200 }
    );
  }
  return NextResponse.json({ updated });
}

/**
 * מחיקת הזמנות מההיסטוריה (מנהל ראשי בלבד).
 * גוף: { ids: [...] } למחיקה נקודתית, או { scope: "handled" } לכל המטופלות.
 * ממתינות לא נמחקות דרך scope - רק לפי מזהה מפורש.
 */
export async function DELETE(req: NextRequest) {
  if (!isMasterAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { ids?: string[]; scope?: string };
  if (!body.ids?.length && body.scope !== "handled") {
    return NextResponse.json({ error: "ids או scope=handled נדרשים" }, { status: 400 });
  }
  const deleted = await deleteReservations({
    ids: body.ids,
    scope: body.scope === "handled" ? "handled" : undefined,
  });
  return NextResponse.json({ deleted });
}
