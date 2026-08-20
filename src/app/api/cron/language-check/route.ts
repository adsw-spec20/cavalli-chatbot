import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getRepo } from "@/lib/db";
import { recordLlmUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * 🌙 הבדיקה הלילית - "משמרת לילה של עורך לשון".
 * רצה כל לילה (Vercel Cron): אוספת את כל תשובות המודל מ-24 השעות האחרונות
 * (לא תבניות - הן כתובות ידנית) ומריצה עליהן בדיקת לשון אחת מרוכזת.
 * ממצאים נשמרים ב-settings (language_findings, 14 ימים אחרונים) - משם הם
 * נאספים לתיקון בפרומפט/eval. דיווח בלבד: לא משנה שום דבר בעצמה.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "no api key" }, { status: 500 });

  const repo = getRepo();
  const since = Date.now() - 24 * 3600_000;
  const msgs = (await repo.getAllMessages()).filter(
    (m) =>
      m.role === "assistant" &&
      m.ts >= since &&
      !m.meta?.canned &&
      !m.meta?.fallback &&
      !m.meta?.rateLimitNotice
  );
  if (!msgs.length) return NextResponse.json({ checked: 0, findings: 0 });

  // עד 120 תשובות, כל אחת קצוצה - מספיק כדי לתפוס שגיאה, בלי לנפח עלות
  const sample = msgs.slice(-120).map((m, i) => `[${i + 1}] ${m.content.slice(0, 280)}`);

  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 90_000 });
  const model = process.env.CHATBOT_MODEL ?? "claude-sonnet-4-6";
  const res = await client.messages.create({
    model,
    max_tokens: 1500,
    system:
      "אתה עורך לשון קפדן של בוט שירות בעברית. תקבל תשובות שהבוט שלח ללקוחות. מצא אך ורק: " +
      "(1) שגיאות דקדוק והתאמת מין/מספר (למשל 'שתהיה ביקור', 'אני מבינה' כשהבוט זכר, 'תשמח לעזור' במקום 'אשמח'); " +
      "(2) עברית שבורה/מתורגמת או מילים חסרות (למשל 'לאיזה יום ושעה מחשבים', 'לשאול -', 'יש עוד כשעה פחות'); " +
      "(3) ניסוחים מסורבלים שנשמעים רובוטיים; (4) עיצוב שבור (כוכבית כפולה, קו מפריד ארוך, תווים זרים). " +
      "אל תדווח על סגנון תקין, עובדות, אימוג'ים או קיצור. אם הכל תקין - החזר []. " +
      'החזר JSON בלבד: [{"quote":"הציטוט המדויק","problem":"מה הבעיה","fix":"הניסוח הנכון"}] - עד 15 ממצאים, החמורים קודם.',
    messages: [{ role: "user", content: sample.join("\n---\n") }],
  });
  await recordLlmUsage(model, res.usage ?? {});
  let findings: unknown[] = [];
  try {
    const text = res.content?.[0]?.type === "text" ? res.content[0].text : "[]";
    findings = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1)) as unknown[];
  } catch {
    findings = [];
  }

  // שמירה: 14 הימים האחרונים (לאיסוף בסריקה השבועית)
  let history: { ts: number; checked: number; findings: unknown[] }[] = [];
  try {
    history = JSON.parse((await repo.getSetting("language_findings")) ?? "[]");
  } catch {
    /* מתחילים נקי */
  }
  history.push({ ts: Date.now(), checked: sample.length, findings });
  const cutoff = Date.now() - 14 * 24 * 3600_000;
  history = history.filter((h) => h.ts >= cutoff);
  await repo.setSetting("language_findings", JSON.stringify(history));

  console.log(`[language-check] נבדקו ${sample.length} תשובות, ${findings.length} ממצאים`);

  // 💾 גיבוי לילי עצמאי: כל הדאטה העסקית ל-Vercel Blob (בנוסף לשכפול של Neon).
  // רץ באותו cron לילי כי בתוכנית Vercel יש מגבלת מספר crons.
  let backup = "skipped";
  try {
    const settingsKeys = [
      "business_config",
      "reservations",
      "media_library",
      "quick_replies",
      "team_members",
      "questionnaire_answers",
      "language_findings",
      "alert_email",
      "alert_phones",
    ];
    const settings: Record<string, string | null> = {};
    for (const k of settingsKeys) settings[k] = (await repo.getSetting(k)) ?? null;
    const dump = JSON.stringify({
      ts: Date.now(),
      conversations: await repo.listConversations(),
      messages: await repo.getAllMessages(),
      learnedQA: await repo.listLearnedQA(),
      settings,
    });
    const { put, list, del } = await import("@vercel/blob");
    const day = new Date().toISOString().slice(0, 10);
    await put(`backups/cavalli-${day}.json`, dump, {
      access: "public", // הכתובת אקראית ולא ניתנת לניחוש (addRandomSuffix)
      addRandomSuffix: true,
      contentType: "application/json",
    });
    // שימור 14 גיבויים אחרונים בלבד
    const existing = await list({ prefix: "backups/" });
    const sorted = existing.blobs.sort((a, b) => +new Date(b.uploadedAt) - +new Date(a.uploadedAt));
    for (const old of sorted.slice(14)) await del(old.url);
    backup = `ok (${Math.round(dump.length / 1024)}KB)`;
    console.log(`[backup] נשמר גיבוי יומי: ${Math.round(dump.length / 1024)}KB`);
  } catch (err) {
    console.error("[backup] הגיבוי הלילי נכשל:", err);
    backup = "failed";
  }

  return NextResponse.json({ checked: sample.length, findings: findings.length, backup });
}
