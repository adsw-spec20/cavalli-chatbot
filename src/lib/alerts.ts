/**
 * התראות לצוות על הסלמות.
 *
 * אימייל דרך Resend - מופעל רק אם מוגדרים RESEND_API_KEY ו-ALERT_EMAIL.
 * אם לא מוגדרים, הפונקציה לא עושה כלום (לוג בלבד), כך שאפשר להפעיל בעתיד
 * בלי לשנות קוד.
 */

/** מנטרל HTML בערכים שמקורם בלקוח/מודל לפני שיבוץ בתבנית האימייל */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendEscalationEmail(args: {
  customerName?: string;
  channel: string;
  reason: string;
  summary: string;
  urgent?: boolean;
}): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL;
  if (!key || !to) return; // לא מוגדר - מדלגים בשקט

  const subject = `${args.urgent ? "🔴 דחוף - " : ""}הסלמה חדשה (${args.channel}) - קפה קוואלי`;
  const html = `
    <div style="font-family:sans-serif;direction:rtl">
      <h2>${args.urgent ? "🔴 פנייה דחופה" : "פנייה חדשה לטיפול"}</h2>
      <p><b>לקוח:</b> ${escapeHtml(args.customerName || "לא ידוע")} · <b>ערוץ:</b> ${escapeHtml(args.channel)}</p>
      <p><b>סיבה:</b> ${escapeHtml(args.reason)}</p>
      <p><b>סיכום:</b> ${escapeHtml(args.summary)}</p>
      <p><a href="https://cavalli-chatbot.vercel.app/admin">פתח את הפאנל</a></p>
    </div>`;

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Cavalli Bot <onboarding@resend.dev>",
        to: [to],
        subject,
        html,
      }),
    });
  } catch (err) {
    console.error("[alerts] email failed:", err);
  }
}
