import { NextRequest, NextResponse } from "next/server";
import { getBotEnabled, setBotEnabled } from "@/lib/admin-service";
import { getAuthInfo, isMasterAuthorized } from "@/lib/admin-auth";
import { getRepo } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await getAuthInfo(req);
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // role+name: הפאנל משתמש בזה כדי לדעת מי מחובר (מנהל/איש צוות)
  // alertEmail/alertPhones: יעדי ההתראות - מוצגים לעריכה למנהל בלבד
  // ביצועים: כל השאילתות במקביל - כל await עוקב היה עוד נסיעת רשת ל-DB
  const [alertEmailRaw, alertPhonesRaw, alarmRaw, botEnabled] = await Promise.all([
    auth.role === "master" ? getRepo().getSetting("alert_email") : Promise.resolve(null),
    auth.role === "master" ? getRepo().getSetting("alert_phones") : Promise.resolve(null),
    getRepo().getSetting("api_alarm"),
    getBotEnabled(),
  ]);
  const alertEmail = auth.role === "master" ? (alertEmailRaw ?? "") : undefined;
  const alertPhones = auth.role === "master" ? (alertPhonesRaw ?? "") : undefined;
  // אזעקת מערכת (כשל מודל / קרדיטים שאזלו) - מוצגת כבאנר אדום לכל הצוות
  let alarm: { ts: number; reason: string } | undefined;
  try {
    if (alarmRaw) {
      const parsed = JSON.parse(alarmRaw) as { ts: number; reason: string };
      // רלוונטית רק אם טרייה (עד 24 שעות) - אחרת מתעלמים
      if (parsed?.ts && Date.now() - parsed.ts < 24 * 3600_000) alarm = parsed;
    }
  } catch {
    /* אין אזעקה */
  }
  return NextResponse.json({
    botEnabled,
    role: auth.role,
    name: auth.name,
    alertEmail,
    alertPhones,
    emailConfigured: !!process.env.RESEND_API_KEY,
    alarm,
  });
}

export async function POST(req: NextRequest) {
  const auth = await getAuthInfo(req);
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json();

  if (typeof body.botEnabled === "boolean") {
    await setBotEnabled(body.botEnabled);
    return NextResponse.json({ botEnabled: body.botEnabled });
  }

  // כיבוי ידני של אזעקת המערכת (אחרי שטופלה)
  if (body.clearAlarm === true) {
    await getRepo().setSetting("api_alarm", "");
    return NextResponse.json({ cleared: true });
  }

  // עדכון יעד ההתראות - מנהל בלבד
  if (typeof body.alertEmail === "string") {
    if (!isMasterAuthorized(req)) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    // מותר כמה כתובות מופרדות בפסיק - מאמתים כל אחת בנפרד
    const email = body.alertEmail.trim();
    const parts = email ? email.split(/[,;]+/).map((e: string) => e.trim()).filter(Boolean) : [];
    const bad = parts.find((e: string) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (bad) {
      return NextResponse.json({ error: `כתובת אימייל לא תקינה: ${bad}` }, { status: 400 });
    }
    const normalized = parts.join(", ");
    await getRepo().setSetting("alert_email", normalized);
    return NextResponse.json({ alertEmail: normalized });
  }

  // עדכון מספרי וואטסאפ להתראות צוות - מנהל בלבד
  if (typeof body.alertPhones === "string") {
    if (!isMasterAuthorized(req)) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const parts = body.alertPhones
      ? body.alertPhones.split(/[,;\s]+/).map((p: string) => p.trim()).filter(Boolean)
      : [];
    const bad = parts.find((p: string) => !/^0?\d{9,12}$/.test(p.replace(/[-\s]/g, "")));
    if (bad) {
      return NextResponse.json({ error: `מספר טלפון לא תקין: ${bad}` }, { status: 400 });
    }
    const normalized = parts.map((p: string) => p.replace(/[-\s]/g, "")).join(", ");
    await getRepo().setSetting("alert_phones", normalized);
    return NextResponse.json({ alertPhones: normalized });
  }

  return NextResponse.json({ error: "invalid body" }, { status: 400 });
}
