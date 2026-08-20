/**
 * דוח יומי לבעלים במייל.
 *
 * נשלח כל בוקר (Vercel Cron) ומסכם את היום הקודם: כמה שיחות והודעות,
 * הסלמות, על מה שאלו הכי הרבה, ומה ממתין לטיפול. בלי נתוני עלות (פנימי).
 * משתמש באותה תשתית Resend של ההתראות - אם אין מפתח, לא נשלח כלום.
 */

import { getRepo } from "./db";
import { sendAlertEmail, escapeHtml } from "./alerts";
import { topicBreakdown } from "./insights";

const PANEL_URL = "https://cavalli-chatbot.vercel.app/admin";
const CHANNEL_HE: Record<string, string> = {
  whatsapp: "וואטסאפ",
  messenger: "מסנג'ר",
  instagram: "אינסטגרם",
  playground: "בדיקות",
};

export interface DailyReportData {
  dateISO: string;
  dateLabel: string;
  conversations: number;
  userMessages: number;
  botReplies: number;
  agentReplies: number;
  escalations: number;
  byChannel: { channel: string; count: number }[];
  topics: { topic: string; count: number }[];
  openQuestions: number;
  awaitingReplies: number;
}

/** גבולות היממה (שעון ישראל) של תאריך ISO נתון. */
function dayBounds(dateISO: string): { start: number; end: number } {
  // חצות ישראל = 21:00-22:00 UTC ביום הקודם; דיוק של שעה מספיק לדוח יומי,
  // אז מקרבים לפי UTC+3 (שעון קיץ ישראל; בחורף הסטייה שעה - זניח לסיכום).
  const start = Date.parse(`${dateISO}T00:00:00+03:00`);
  return { start, end: start + 24 * 60 * 60 * 1000 };
}

export async function buildDailyReport(dateISO: string): Promise<DailyReportData> {
  const repo = getRepo();
  const [convs, msgs, openQA] = await Promise.all([
    repo.listConversations(),
    repo.getAllMessages(),
    repo.listLearnedQA("open"),
  ]);
  const { start, end } = dayBounds(dateISO);
  const inDay = msgs.filter((m) => m.ts >= start && m.ts < end);

  const userMsgs = inDay.filter((m) => m.role === "user");
  const botReplies = inDay.filter((m) => m.role === "assistant").length;
  const agentReplies = inDay.filter((m) => m.role === "agent").length;
  const escalations = inDay.filter((m) => m.role === "system" && m.meta?.escalation).length;

  // שיחות שהתחילו היום + פילוח ערוצים שלהן
  const dayConvs = convs.filter((c) => c.createdAt >= start && c.createdAt < end);
  const chCounts = new Map<string, number>();
  for (const c of dayConvs) chCounts.set(c.channel, (chCounts.get(c.channel) ?? 0) + 1);

  const awaitingReplies = convs.filter((c) => c.status === "human").length;

  const [y, m, d] = dateISO.split("-");
  return {
    dateISO,
    dateLabel: `${d}/${m}/${y}`,
    conversations: dayConvs.length,
    userMessages: userMsgs.length,
    botReplies,
    agentReplies,
    escalations,
    byChannel: [...chCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([channel, count]) => ({ channel, count })),
    topics: topicBreakdown(userMsgs.map((m) => m.content)).slice(0, 6),
    openQuestions: openQA.length,
    awaitingReplies,
  };
}

function statCell(label: string, value: string | number): string {
  return `<td style="background:#f7f5f0;border-radius:10px;padding:12px;text-align:center;min-width:70px">
    <div style="font-size:22px;font-weight:bold">${value}</div>
    <div style="font-size:12px;color:#777">${label}</div>
  </td>`;
}

export function renderDailyReportHtml(r: DailyReportData): string {
  const topicsRows = r.topics
    .map(
      (t) =>
        `<tr><td style="padding:4px 8px">${escapeHtml(t.topic)}</td><td style="padding:4px 8px;text-align:left"><b>${t.count}</b></td></tr>`
    )
    .join("");
  const channelsLine = r.byChannel
    .map((c) => `${CHANNEL_HE[c.channel] ?? c.channel}: ${c.count}`)
    .join(" · ");

  const attention =
    r.awaitingReplies > 0 || r.openQuestions > 0
      ? `<div style="background:#fdf3dc;border-radius:10px;padding:12px;margin-top:14px">
          <b>ממתין לכם בפאנל:</b>
          ${r.awaitingReplies > 0 ? `<div>• ${r.awaitingReplies} שיחות ממתינות לנציג</div>` : ""}
          ${r.openQuestions > 0 ? `<div>• ${r.openQuestions} שאלות שהבוט לא ידע לענות עליהן (מסך "ידע")</div>` : ""}
        </div>`
      : `<div style="color:#2f6b51;margin-top:14px">✅ אין שיחות או שאלות שממתינות לטיפול.</div>`;

  return `
  <div style="font-family:sans-serif;direction:rtl;max-width:560px;margin:auto">
    <h2 style="margin-bottom:2px">☕ קפה קוואלי - סיכום יומי</h2>
    <div style="color:#777;margin-bottom:14px">${r.dateLabel}</div>

    <table style="border-collapse:separate;border-spacing:6px;width:100%"><tr>
      ${statCell("שיחות", r.conversations)}
      ${statCell("הודעות מלקוחות", r.userMessages)}
      ${statCell("תשובות בוט", r.botReplies)}
      ${statCell("הסלמות", r.escalations)}
    </tr></table>

    ${r.agentReplies > 0 ? `<div style="color:#555;margin-top:6px">תשובות נציגים: ${r.agentReplies}</div>` : ""}
    ${channelsLine ? `<div style="color:#555;margin-top:4px">ערוצים: ${channelsLine}</div>` : ""}

    ${
      r.topics.length
        ? `<h3 style="margin-bottom:6px;margin-top:18px">על מה שאלו</h3>
           <table style="border-collapse:collapse">${topicsRows}</table>`
        : ""
    }

    ${attention}

    <p style="margin-top:18px"><a href="${PANEL_URL}">פתיחת הפאנל</a></p>
    <p style="color:#aaa;font-size:11px">דוח אוטומטי מהעוזר הדיגיטלי של קפה קוואלי</p>
  </div>`;
}

/** בונה ושולח את הדוח על תאריך נתון. מחזיר אם נשלח בפועל. */
export async function sendDailyReport(dateISO: string): Promise<boolean> {
  const report = await buildDailyReport(dateISO);
  // אם לא היתה שום פעילות - לא שולחים מייל ריק
  if (report.userMessages === 0 && report.awaitingReplies === 0 && report.openQuestions === 0) {
    return false;
  }
  return sendAlertEmail(
    `☕ סיכום יומי ${report.dateLabel} - ${report.conversations} שיחות, ${report.escalations} הסלמות`,
    renderDailyReportHtml(report)
  );
}
