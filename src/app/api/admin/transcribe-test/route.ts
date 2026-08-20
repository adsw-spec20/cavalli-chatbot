import { NextRequest, NextResponse } from "next/server";
import { isMasterAuthorized } from "@/lib/admin-auth";
import { transcribeAudio } from "@/lib/transcription";

export const runtime = "nodejs";
export const maxDuration = 90;

/**
 * בדיקה עצמית של מערך התמלול (מנהל בלבד) - לאבחון איכות ותקינות בלי הקלטה אמיתית.
 * מסנתז אודיו עברי (TTS של OpenAI) מהמשפט שנשלח, מריץ אותו דרך צינור התמלול
 * הרגיל של הבוט (gpt-4o-transcribe עם נפילה ל-whisper-1), ומחזיר את התוצאה
 * להשוואה מול המקור. שימוש: POST {"text": "משפט לבדיקה"}.
 */
export async function POST(req: NextRequest) {
  if (!isMasterAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY לא מוגדר" }, { status: 500 });
  }
  const body = (await req.json().catch(() => ({}))) as { text?: string };
  const text = (body.text ?? "").trim();
  if (!text || text.length > 300) {
    return NextResponse.json({ error: "נדרש text (עד 300 תווים)" }, { status: 400 });
  }

  // סינתזה קולית של המשפט (מדמה הקלטה של לקוח)
  const ttsRes = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "tts-1", voice: "nova", input: text, response_format: "mp3", speed: 1.15 }),
  });
  if (!ttsRes.ok) {
    return NextResponse.json(
      { error: `TTS נכשל (${ttsRes.status}): ${(await ttsRes.text()).slice(0, 200)}` },
      { status: 502 }
    );
  }
  const audio = await ttsRes.arrayBuffer();

  const transcribed = await transcribeAudio(audio, "test.mp3", "audio/mpeg");
  return NextResponse.json({
    original: text,
    transcribed,
    audioBytes: audio.byteLength,
    match: transcribed !== null && transcribed.replace(/[.,!?״"']/g, "") === text.replace(/[.,!?״"']/g, ""),
  });
}
