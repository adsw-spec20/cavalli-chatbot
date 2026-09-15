/** מדידת עלות אמיתית של תור אחד במעבדת טאביט. ספירת טוקנים בלבד - עלות אפס. */
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
const src = readFileSync("src/lib/tabit-lab.ts", "utf8");
const sysM = src.match(/const SYSTEM\s*=\s*`([\s\S]*?)`;/);
const toolsM = src.match(/const tools[^=]*=\s*(\[[\s\S]*?\n\];)/) || src.match(/const TOOLS[^=]*=\s*(\[[\s\S]*?\n\];)/);
const SYSTEM = sysM ? sysM[1] : "";
const toolsRaw = toolsM ? toolsM[1] : "";
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const count = async (system: string, msgs: Anthropic.MessageParam[], tools?: Anthropic.Tool[]) =>
  (await client.messages.countTokens({ model: "claude-haiku-4-5-20251001", system, messages: msgs, ...(tools ? { tools } : {}) })).input_tokens;

// הכלים כטקסט גולמי - מספיק כדי להעריך את גודלם בטוקנים
const baseline = await count("x", [{ role: "user", content: "x" }]);
const withSystem = await count(SYSTEM, [{ role: "user", content: "x" }]);
const withTools = await count("x", [{ role: "user", content: toolsRaw.slice(0, 20000) }]);
console.log(`SYSTEM של המעבדה : ${(withSystem - baseline).toLocaleString()} טוקנים (${SYSTEM.length.toLocaleString()} תווים)`);
console.log(`הגדרות 14 הכלים  : ~${(withTools - baseline).toLocaleString()} טוקנים (${toolsRaw.length.toLocaleString()} תווים)`);
const fixed = (withSystem - baseline) + (withTools - baseline);
console.log(`\nתקורה קבועה לכל קריאה: ~${fixed.toLocaleString()} טוקנים`);
const H_IN = 1, H_OUT = 5; // Haiku 4.5 per million
console.log(`במחיר Haiku (\$${H_IN}/מיליון קלט): ~\$${((fixed * H_IN) / 1e6).toFixed(4)} לקריאה בודדת`);
console.log(`\nתור עם 3 סבבי כלים (תקורה x3 + תוצאות מצטברות):`);
for (const res of [2000, 8000, 20000]) {
  // סבב1: fixed. סבב2: fixed+res. סבב3: fixed+2res
  const total = fixed * 3 + res * 3;
  console.log(`  תוצאות כלי ~${res.toLocaleString()} טוקנים -> ~${total.toLocaleString()} טוקנים = \$${((total * H_IN) / 1e6 + (600 * H_OUT) / 1e6).toFixed(4)}`);
}
