/**
 * ביקורת גודל של ה-System Prompt - כמה תווים/טוקנים כל חלק תופס.
 * הרצה: npx tsx scripts/prompt-audit.mts
 * לא שולח שום דבר למודל (חוץ מספירת טוקנים, שהיא חינם ב-API).
 */
import { loadBusinessConfig } from "../src/lib/business-config-store";
import { loadMedia } from "../src/lib/media-store";
import { buildSystemPrompt } from "../src/lib/system-prompt";

const cfg = await loadBusinessConfig();
const media = await loadMedia();
const prompt = buildSystemPrompt(cfg, media);

console.log(`\n===== סה"כ פרומפט: ${prompt.length.toLocaleString()} תווים =====\n`);

// פיצול לפי כותרות ראשיות (# ...) ולפי כללי הברזל הממוספרים
type Sec = { name: string; chars: number };
const secs: Sec[] = [];
const lines = prompt.split("\n");
let cur = "(פתיחה)";
let buf: string[] = [];
const flush = () => {
  const chars = buf.join("\n").length;
  if (chars > 0) secs.push({ name: cur, chars });
  buf = [];
};
for (const ln of lines) {
  const h = ln.match(/^#\s+(.+)$/);
  const rule = ln.match(/^(\d+)\.\s+\*\*(.+?)\*\*/);
  if (h) {
    flush();
    cur = `# ${h[1]}`;
  } else if (rule) {
    flush();
    cur = `כלל ${rule[1]}: ${rule[2].slice(0, 55)}`;
  }
  buf.push(ln);
}
flush();

secs.sort((a, b) => b.chars - a.chars);
const total = prompt.length;
console.log("החלקים הגדולים ביותר:\n");
for (const s of secs) {
  const pct = (s.chars / total) * 100;
  if (pct < 0.8) continue;
  const bar = "█".repeat(Math.max(1, Math.round(pct / 1.2)));
  console.log(`${String(s.chars).padStart(6)} תווים  ${pct.toFixed(1).padStart(5)}%  ${bar} ${s.name}`);
}

// ספירת טוקנים מדויקת (endpoint חינמי)
if (process.env.ANTHROPIC_API_KEY) {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const r = await client.messages.countTokens({
    model: "claude-sonnet-4-6",
    system: prompt,
    messages: [{ role: "user", content: "היי" }],
  });
  console.log(`\n===== טוקנים מדויקים בפרומפט: ${r.input_tokens.toLocaleString()} =====`);
  console.log(`יחס: ${(prompt.length / r.input_tokens).toFixed(2)} תווים לטוקן`);
}
