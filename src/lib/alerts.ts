/**
 * התראות במייל לצוות (דרך Resend).
 *
 * מופעל רק אם מוגדר RESEND_API_KEY. כתובת היעד נקבעת בפאנל (הגדרות > התראות,
 * נשמרת ב-settings תחת "alert_email") עם fallback ל-ALERT_EMAIL מהסביבה.
 * בלי הגדרה - הפונקציות לא עושות כלום, כך שהקוד בטוח לפריסה בכל מצב.
 *
 * סוגי התראות:
 *  - הסלמה לנציג (מיידי, עם סימון דחוף)
 *  - שאלה חדשה שהבוט לא ידע לענות עליה (עם ויסות - מקסימום אחת לשעה)
 *  - דוח יומי (נשלח מה-cron, ראה daily-report.ts)
 */

import { getRepo } from "./db";
import { sendTeamPush } from "./push";

const PANEL_URL = "https://cavalli-chatbot.vercel.app/admin";

/** מנטרל HTML בערכים שמקורם בלקוח/מודל לפני שיבוץ בתבנית האימייל */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** יעדי ההתראות: ההגדרה מהפאנל (מותר כמה כתובות בפסיקים), אחרת משתנה הסביבה. */
async function getAlertTarget(): Promise<{ key: string; to: string[] } | null> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  let raw = "";
  try {
    raw = (await getRepo().getSetting("alert_email")) ?? "";
  } catch {
    /* ניפול ל-env */
  }
  if (!raw) raw = process.env.ALERT_EMAIL ?? "";
  const to = raw
    .split(/[,;\s]+/)
    .map((e) => e.trim())
    .filter((e) => e.includes("@"));
  return to.length ? { key, to } : null;
}

/** שליחת מייל התראה כללי. שקט בכשל (התראה היא לא סיבה להפיל את הזרימה). */
export async function sendAlertEmail(subject: string, html: string): Promise<boolean> {
  const target = await getAlertTarget();
  if (!target) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${target.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Cavalli Bot <onboarding@resend.dev>",
        to: target.to,
        subject,
        html,
      }),
    });
    if (!res.ok) console.error("[alerts] Resend החזיר", res.status, await res.text());
    return res.ok;
  } catch (err) {
    console.error("[alerts] שליחת מייל נכשלה:", err);
    return false;
  }
}

// ----- התראות וואטסאפ לצוות (מהמספר העסקי, דרך תבנית team_alert מאושרת) -----
// תבנית מאושרת מותרת גם מחוץ לחלון 24 השעות; דורשת אמצעי תשלום ב-WABA.
const WA_TEMPLATE = "team_alert";
const CHANNEL_HE: Record<string, string> = {
  whatsapp: "וואטסאפ",
  messenger: "מסנג'ר",
  instagram: "אינסטגרם",
  playground: "בדיקה",
};

/** מספרי הוואטסאפ של הצוות (settings alert_phones), מנורמלים ל-972... */
async function getAlertPhones(): Promise<string[]> {
  try {
    const raw = (await getRepo().getSetting("alert_phones")) ?? "";
    return raw
      .split(/[,;\s]+/)
      .map((p) => p.replace(/\D/g, ""))
      .filter((p) => p.length >= 9)
      .map((p) => (p.startsWith("0") ? "972" + p.slice(1) : p));
  } catch {
    return [];
  }
}

/**
 * שליחת התראת וואטסאפ לכל אנשי הצוות שהוגדרו בפאנל. שקט בכשל.
 * מגבלת תבניות: הפרמטר חייב להיות שורה אחת - שורות חדשות מוחלפות ברווח.
 */
export async function sendTeamWhatsAppAlert(text: string): Promise<void> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) return;
  const phones = await getAlertPhones();
  if (!phones.length) return;
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 500);
  if (!clean) return;
  await Promise.all(
    phones.map(async (to) => {
      try {
        const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to,
            type: "template",
            template: {
              name: WA_TEMPLATE,
              language: { code: "he" },
              components: [{ type: "body", parameters: [{ type: "text", text: clean }] }],
            },
          }),
        });
        if (!res.ok) {
          console.error(`[alerts] וואטסאפ לצוות (${to}) נכשל (${res.status}):`, (await res.text()).slice(0, 300));
        }
      } catch (err) {
        console.error("[alerts] וואטסאפ לצוות נכשל:", err);
      }
    })
  );
}

// אזעקת מערכת (המודל נפל / קרדיטים): לכל היותר התראה אחת לשעה, שלא נציף בתקלה מתמשכת
const ALARM_WA_THROTTLE_MS = 60 * 60 * 1000;
export async function sendSystemAlarmWhatsApp(reason: string): Promise<void> {
  try {
    const repo = getRepo();
    const last = Number((await repo.getSetting("last_alarm_wa_ts")) ?? 0);
    if (Date.now() - last < ALARM_WA_THROTTLE_MS) return;
    await repo.setSetting("last_alarm_wa_ts", String(Date.now()));
    const alarmText =
      reason === "credit"
        ? "🚨 תקלה: נגמרו הקרדיטים של הבוט! לקוחות מקבלים הודעת תקלה. יש להטעין קרדיטים ב-console.anthropic.com בהקדם"
        : "🚨 תקלת מערכת: הבוט לא מצליח לענות ללקוחות כרגע. בדקו את הפאנל";
    await Promise.all([
      sendTeamWhatsAppAlert(alarmText),
      sendTeamPush({ title: "🚨 תקלת מערכת - הבוט", body: alarmText, tag: "system-alarm" }),
    ]);
  } catch (err) {
    console.error("[alerts] התראת אזעקה בוואטסאפ נכשלה:", err);
  }
}

export async function sendEscalationEmail(args: {
  customerName?: string;
  channel: string;
  reason: string;
  summary: string;
  urgent?: boolean;
}): Promise<void> {
  const subject = `${args.urgent ? "🔴 דחוף - " : ""}הסלמה חדשה (${args.channel}) - קפה קוואלי`;
  const html = `
    <div style="font-family:sans-serif;direction:rtl">
      <h2>${args.urgent ? "🔴 פנייה דחופה" : "פנייה חדשה לטיפול"}</h2>
      <p><b>לקוח:</b> ${escapeHtml(args.customerName || "לא ידוע")} · <b>ערוץ:</b> ${escapeHtml(args.channel)}</p>
      <p><b>סיבה:</b> ${escapeHtml(args.reason)}</p>
      <p><b>סיכום:</b> ${escapeHtml(args.summary)}</p>
      <p><a href="${PANEL_URL}">פתיחת הפאנל</a></p>
    </div>`;
  // מייל (אם מוגדר Resend) + וואטסאפ לצוות (אם הוגדרו מספרים) + פוש - במקביל
  const ch = CHANNEL_HE[args.channel] ?? args.channel;
  await Promise.all([
    sendAlertEmail(subject, html),
    sendTeamWhatsAppAlert(
      `${args.urgent ? "🔴 דחוף! " : ""}הסלמה חדשה ב${ch} מאת ${args.customerName || "לקוח"}: ${args.summary || args.reason}`
    ),
    sendTeamPush({
      title: `${args.urgent ? "🔴 דחוף! " : "🔔 "}שיחה עברה לנציג (${ch})`,
      body: `${args.customerName || "לקוח"}: ${args.summary || args.reason}`.slice(0, 180),
      tag: "escalation",
    }),
  ]);
}

// ויסות התראות "שאלה חדשה בידע": מקסימום מייל אחד לשעה (השאר מכוסות בדוח היומי)
const GAP_ALERT_THROTTLE_MS = 60 * 60 * 1000;

export async function sendKnowledgeGapEmail(question: string): Promise<void> {
  try {
    const repo = getRepo();
    const last = Number((await repo.getSetting("last_gap_alert_ts")) ?? 0);
    if (Date.now() - last < GAP_ALERT_THROTTLE_MS) return;
    await repo.setSetting("last_gap_alert_ts", String(Date.now()));

    const html = `
      <div style="font-family:sans-serif;direction:rtl">
        <h2>🧠 הבוט נתקל בשאלה שהוא לא ידע לענות עליה</h2>
        <p style="background:#f5f5f5;border-radius:8px;padding:12px"><b>"${escapeHtml(question)}"</b></p>
        <p>כשתענו עליה בפאנל (מסך "ידע") - הבוט ילמד אותה ויידע לענות בפעם הבאה.</p>
        <p><a href="${PANEL_URL}">פתיחת הפאנל</a></p>
        <p style="color:#888;font-size:12px">כדי לא להציף, נשלחת התראה כזו לכל היותר פעם בשעה. שאלות נוספות מרוכזות בדוח היומי.</p>
      </div>`;
    await sendAlertEmail("🧠 שאלה חדשה לבוט - קפה קוואלי", html);
  } catch (err) {
    console.error("[alerts] התראת פער ידע נכשלה:", err);
  }
}
