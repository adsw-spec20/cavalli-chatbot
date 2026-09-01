import { NextRequest, NextResponse } from "next/server";
import { isMasterAuthorized } from "@/lib/admin-auth";
import { whatsappAdapter } from "@/lib/channels/whatsapp";
import { getMediaLibrary } from "@/lib/admin-service";

export const runtime = "nodejs";
export const maxDuration = 30;

const V = "v21.0";
const APP_ID = "1499744815172250";

/**
 * אבחון חיבור וואטסאפ (מנהל בלבד) - עונה על שלוש שאלות:
 * 1. הטוקן תקף ומחובר למספר? (GET על ה-phone number id)
 * 2. האפליקציה רשומה לאירועי ה-WABA? (subscribed_apps)
 * 3. לאן ה-webhook של האפליקציה מצביע ואילו שדות רשומים? (app subscriptions)
 * POST עם {action:"subscribe", wabaId} מרשם את האפליקציה ל-WABA בכוח.
 */
export async function GET(req: NextRequest) {
  if (!isMasterAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const appSecret = process.env.META_APP_SECRET;
  const wabaId = req.nextUrl.searchParams.get("wabaId");

  // אבחון צורת הטוקן בלי לחשוף אותו: אורך, תחילית, תווים בעייתיים
  const tokenInfo = token
    ? {
        length: token.length,
        startsWithEAA: token.startsWith("EAA"),
        hasWhitespace: /\s/.test(token),
        hasNonAscii: /[^\x21-\x7e]/.test(token),
      }
    : null;
  const out: Record<string, unknown> = {
    env: { hasToken: !!token, tokenInfo, phoneId: phoneId ?? null, hasAppSecret: !!appSecret },
  };

  const call = async (path: string) => {
    const r = await fetch(`https://graph.facebook.com/${V}${path}`);
    const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: r.status, body: d };
  };

  // 1. הטוקן מול המספר
  if (token && phoneId) {
    out.phoneCheck = await call(
      `/${phoneId}?fields=display_phone_number,verified_name,quality_rating,code_verification_status&access_token=${encodeURIComponent(token)}`
    );
  }
  // 2. רישום האפליקציה ל-WABA
  if (token && wabaId) {
    out.wabaSubscribedApps = await call(
      `/${wabaId}/subscribed_apps?access_token=${encodeURIComponent(token)}`
    );
  }
  // 3. הגדרת ה-webhook ברמת האפליקציה (URL + שדות)
  if (appSecret) {
    out.appSubscriptions = await call(
      `/${APP_ID}/subscriptions?access_token=${APP_ID}|${encodeURIComponent(appSecret)}`
    );
  }
  return NextResponse.json(out);
}

export async function POST(req: NextRequest) {
  if (!isMasterAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const body = (await req.json().catch(() => ({}))) as { action?: string; wabaId?: string; to?: string };
  // ה-WABA שנקלט מה-webhook משמש כברירת מחדל, כדי שלא צריך להעביר אותו בכל קריאה
  if (!body.wabaId) {
    const { getRepo } = await import("@/lib/db");
    body.wabaId = (await getRepo().getSetting("waba_id")) ?? undefined;
  }

  // בדיקת שליחת סרטון החניה למספר נתון (דרך אותו מסלול קוד שמשרת לקוחות אמיתיים)
  if (body.action === "sendVideo") {
    if (!body.to) return NextResponse.json({ error: "נדרש to (מספר בפורמט 9725...)" }, { status: 400 });
    const video = (await getMediaLibrary()).find(
      (m) => m.type === "video" && m.url && /חני/.test(`${m.label} ${m.keywords}`)
    );
    if (!video) return NextResponse.json({ error: "לא נמצא סרטון חניה בספרייה" }, { status: 404 });
    try {
      await whatsappAdapter.sendMedia!(body.to, video.url, "video");
      return NextResponse.json({ ok: true, sent: video.url });
    } catch (e) {
      return NextResponse.json({ ok: false, url: video.url, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // גילוי ה-WABA שהטוקן מורשה עליו (debug_token מחזיר target_ids לכל הרשאה),
  // כדי שלא נצטרך להעתיק את המזהה ידנית מ-Business Manager בכל בדיקה
  if (body.action === "discover" && token) {
    const appSecret = process.env.META_APP_SECRET;
    if (!appSecret) return NextResponse.json({ error: "META_APP_SECRET חסר" }, { status: 500 });
    const r = await fetch(
      `https://graph.facebook.com/${V}/debug_token?input_token=${encodeURIComponent(token)}` +
        `&access_token=${APP_ID}|${encodeURIComponent(appSecret)}`
    );
    const d = (await r.json().catch(() => ({}))) as {
      data?: { granular_scopes?: { scope: string; target_ids?: string[] }[]; expires_at?: number };
    };
    const scopes = d.data?.granular_scopes ?? [];
    const wabaIds = new Set(
      scopes
        .filter((s) => s.scope.startsWith("whatsapp_business"))
        .flatMap((s) => s.target_ids ?? [])
    );

    // טוקן של system user לא נושא target_ids, אז נופלים לשרשרת הרגילה:
    // המספר -> ה-WABA שלו, ואם גם זה ריק - העסקים שהטוקן רואה והחשבונות שלהם.
    const probe: Record<string, unknown> = {};
    const get = async (path: string) => {
      const res = await fetch(
        `https://graph.facebook.com/${V}${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`
      );
      return (await res.json().catch(() => ({}))) as Record<string, unknown>;
    };
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (phoneId) {
      const viaPhone = await get(`/${phoneId}?fields=whatsapp_business_account{id,name}`);
      probe.viaPhone = viaPhone;
      const acct = (viaPhone as { whatsapp_business_account?: { id?: string } }).whatsapp_business_account;
      if (acct?.id) wabaIds.add(acct.id);
    }
    if (!wabaIds.size) {
      const biz = await get(`/me/businesses?fields=id,name`);
      probe.businesses = biz;
      for (const b of ((biz.data ?? []) as { id: string }[]).slice(0, 5)) {
        const owned = await get(`/${b.id}/owned_whatsapp_business_accounts?fields=id,name`);
        probe[`owned_${b.id}`] = owned;
        for (const w of (owned.data ?? []) as { id: string }[]) wabaIds.add(w.id);
      }
    }
    // body.wabaId כבר נטען מהאחסון למעלה - זה המזהה שנקלט מה-webhook
    if (body.wabaId) wabaIds.add(body.wabaId);
    return NextResponse.json({
      status: r.status,
      wabaIds: [...wabaIds],
      fromWebhook: body.wabaId ?? null,
      expiresAt: d.data?.expires_at ?? null,
      scopes,
      probe,
    });
  }

  // בריאות החשבון: מגבלות שליחה, מצב בדיקה, ואיכות המספר. אלה הדברים
  // שגורמים ל"מטא החזירה 200 אבל ההודעה לא נמסרה".
  if (body.action === "health" && body.wabaId && token) {
    const get = async (path: string) => {
      const res = await fetch(
        `https://graph.facebook.com/${V}${path}&access_token=${encodeURIComponent(token)}`
      );
      return { status: res.status, body: await res.json().catch(() => ({})) };
    };
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    return NextResponse.json({
      waba: await get(
        `/${body.wabaId}?fields=id,name,account_review_status,business_verification_status,country,ownership_type`
      ),
      phone: phoneId
        ? await get(
            `/${phoneId}?fields=display_phone_number,verified_name,quality_rating,` +
              `code_verification_status,name_status,status,messaging_limit_tier,throughput`
          )
        : null,
      phones: await get(
        `/${body.wabaId}/phone_numbers?fields=display_phone_number,quality_rating,status,messaging_limit_tier`
      ),
    });
  }

  // שליחת התראת בדיקה לצוות (למספרים שהוגדרו בפאנל) - לאימות אחרי חיבור תשלום
  if (body.action === "testAlert") {
    const { sendTeamWhatsAppAlert } = await import("@/lib/alerts");
    await sendTeamWhatsAppAlert("בדיקת מערכת ההתראות של קפה קוואלי 🙂 אם קיבלתם את זה - הכל עובד!");
    return NextResponse.json({ ok: true, note: "נשלח (אם הוגדרו מספרים); בדקו את הוואטסאפ ואת הלוגים" });
  }

  // יצירת תבנית ההתראות לצוות (team_alert) - חד-פעמי; מטא מאשרת תוך דקות בד"כ
  if (body.action === "createTemplate" && body.wabaId && token) {
    const r = await fetch(
      `https://graph.facebook.com/${V}/${body.wabaId}/message_templates?access_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "team_alert",
          language: "he",
          category: "UTILITY",
          components: [
            {
              type: "BODY",
              text: "🔔 התראה מהפאנל של קפה קוואלי:\n\n{{1}}\n\nלטיפול היכנסו לפאנל. אין לענות להודעה זו.",
              example: { body_text: [["הסלמה חדשה במסנג'ר מאת דנה: מבקשת לדבר עם נציג"]] },
            },
            {
              type: "BUTTONS",
              buttons: [{ type: "URL", text: "פתיחת הפאנל", url: "https://cavalli-chatbot.vercel.app/admin" }],
            },
          ],
        }),
      }
    );
    return NextResponse.json({ status: r.status, body: await r.json().catch(() => ({})) });
  }

  // יצירת תבנית "הוראות חניה" לשליחה יזומה (לקוח שביקש בטלפון) - חד-פעמי
  if (body.action === "createParkingTemplate" && body.wabaId && token) {
    const { getBusinessConfig } = await import("@/lib/admin-service");
    const cfg = await getBusinessConfig();
    const waze = cfg.contact.navigationUrl ?? "";
    // v3 = הוספת שורת השער (בחירת בעל העסק 1.9). אי אפשר לערוך תבנית מאושרת
    // והטוקן לא מורשה למחוק, לכן כל שינוי נוסח = שם חדש.
    const name = (body as { templateName?: string }).templateName || "parking_directions_v3";
    const r = await fetch(
      `https://graph.facebook.com/${V}/${body.wabaId}/message_templates?access_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          language: "he",
          category: "UTILITY",
          components: [
            {
              type: "BODY",
              text:
                `היי! כאן קפה קוואלי 🙂 כמה פרטים שיעזרו לכם להגיע אלינו:\n\n` +
                `📍 המלאכה 6, חולון\n${waze ? `ניווט ב-Waze: ${waze}\n` : ""}\n` +
                `🅿️ יש חניה חינמית גדולה צמודה למסעדה. הכניסה אליה קצת מוסתרת, אז הכנו סרטון קצר שמראה בדיוק איך מגיעים:\nhttps://caffecavalli.com/parking\n\n` +
                `🚧 בדרך יש שער לבן. אם הוא סגור, כתבו לנו כאן ונפתח לכם מיד.\n\n` +
                `נתראה בקרוב! ☕`,
            },
          ],
        }),
      }
    );
    return NextResponse.json({ status: r.status, body: await r.json().catch(() => ({})) });
  }

  // יצירת תבנית "תזכורת תשלום" לשליחה יזומה - חד-פעמי.
  // בלי משתנים בכוונה: המארחת מזינה רק מספר טלפון, והקישור הספציפי
  // כבר נשלח ללקוח ב-SMS כשההזמנה אושרה. הנוסח הוא של בעל העסק (1.9) -
  // לא לשנות בלי אישור, כל שינוי דורש מחיקה ואישור מחדש של מטא.
  if (body.action === "createPaymentTemplate" && body.wabaId && token) {
    const name = (body as { templateName?: string }).templateName || "payment_reminder";
    const r = await fetch(
      `https://graph.facebook.com/${V}/${body.wabaId}/message_templates?access_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          language: "he",
          category: "UTILITY",
          components: [
            {
              type: "BODY",
              text:
                "היי, כאן קפה קוואלי 😊\n" +
                "רצינו להזכיר שעדיין לא הושלם הפיקדון בסך 100 ₪ עבור ההזמנה שלכם.\n\n" +
                "כדי להשלים ולאשר את ההזמנה, ניתן לבצע את התשלום בקישור ששלחנו לכם בSMS 🙏",
            },
          ],
        }),
      }
    );
    return NextResponse.json({ status: r.status, body: await r.json().catch(() => ({})) });
  }

  // מחיקת תבנית לפי שם (לעדכון תוכן: מוחקים ויוצרים מחדש)
  if (body.action === "deleteTemplate" && body.wabaId && token) {
    const name = (body as { templateName?: string }).templateName;
    if (!name) return NextResponse.json({ error: "נדרש templateName" }, { status: 400 });
    const r = await fetch(
      `https://graph.facebook.com/${V}/${body.wabaId}/message_templates?name=${encodeURIComponent(name)}&access_token=${encodeURIComponent(token)}`,
      { method: "DELETE" }
    );
    return NextResponse.json({ status: r.status, body: await r.json().catch(() => ({})) });
  }

  // סטטוס התבניות (לבדוק אישור)
  if (body.action === "templates" && body.wabaId && token) {
    const r = await fetch(
      `https://graph.facebook.com/${V}/${body.wabaId}/message_templates?fields=name,status,category,language,components&access_token=${encodeURIComponent(token)}`
    );
    return NextResponse.json({ status: r.status, body: await r.json().catch(() => ({})) });
  }

  if (body.action !== "subscribe" || !body.wabaId || !token) {
    return NextResponse.json({ error: "נדרש action=subscribe + wabaId (וטוקן בסביבה)" }, { status: 400 });
  }
  const r = await fetch(
    `https://graph.facebook.com/${V}/${body.wabaId}/subscribed_apps?access_token=${encodeURIComponent(token)}`,
    { method: "POST" }
  );
  const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return NextResponse.json({ status: r.status, body: d });
}
