/**
 * בדיקת ציות לפורמט של צ'אט המעבדה - מול המודל האמיתי.
 *
 * למה צריך בדיקה שעולה כסף: כל השאר בפרויקט נבדק בקוד, אבל השאלה כאן היא
 * **האם המודל מציית להוראה**, וזה אי אפשר לבדוק בלי לשאול אותו. התקלה שהובילה
 * לזה (17.9): נשאל "כמה שולחנות יש היום מהשעה 17:00", הכלי החזיר רשימה מוכנה,
 * והמודל כתב במקומה סיכום חופשי משלו - עם ספירת פיקדונות שגויה.
 *
 * הבדיקה מדמה בדיוק את הסבב הזה: פרומפט המערכת האמיתי, קריאת כלי, ותוצאה
 * שמכילה rendered. אין כאן גשר לטאביט ואין צורך בו.
 *
 * הרצה: npx tsx scripts/lab-format-live-test.mts   (עולה סנטים בודדים)
 */
import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM, TOOLS } from "../src/lib/tabit-lab";
import { calendarBlock, hoursBlock } from "../src/lib/tabit-lab-smart";
import { businessConfig } from "../src/lib/business-config";
import { renderReservationList, type TabitResRow } from "../src/lib/tabit-format";

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.log("חסר ANTHROPIC_API_KEY - מדלג");
  process.exit(0);
}

const DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

const ROWS: TabitResRow[] = [
  { id: "1", name: "דניאלה", phone: "0501112222", seats: 18, day: DAY, time: "17:30", tables: [31, 32, 33, 34], deposit: "missing" },
  { id: "2", name: "יעקב", phone: "0523334444", seats: 2, day: DAY, time: "19:30", tables: [44], deposit: "none" },
  { id: "3", name: "ישראל ברט", phone: "0545556666", seats: 5, day: DAY, time: "20:00", tables: [57], deposit: "secured" },
  { id: "4", name: "אליאב", phone: "0507778888", seats: 6, day: DAY, time: "20:00", tables: [30], deposit: "missing" },
  { id: "5", name: "נויה", phone: "0539990000", seats: 2, day: DAY, time: "21:30", tables: [42], deposit: "none" },
  { id: "6", name: "הילה ושגיב", phone: "0521234567", seats: 2, day: DAY, time: "21:30", tables: [44], deposit: "secured" },
];
const rendered = renderReservationList({
  title: "כל ההזמנות",
  dayISO: DAY,
  list: ROWS,
  scopeNote: "מ-17:00 ואילך",
});

const anthropic = new Anthropic({ apiKey: key, maxRetries: 1, timeout: 60_000 });
const toolResult = {
  resolved_day: DAY,
  source: "snapshot",
  count: ROWS.length,
  covers: ROWS.reduce((s, r) => s + (r.seats ?? 0), 0),
  filtered_range: "מ-17:00 ואילך",
  reservations: ROWS,
  rendered,
};

const resp = await anthropic.messages.create({
  model: "claude-haiku-4-5-20251001",
  max_tokens: 3000,
  system: [
    { type: "text", text: SYSTEM },
    { type: "text", text: [`השעה בישראל כעת: 18:00.`, calendarBlock(), hoursBlock(businessConfig)].join("\n\n") },
  ],
  tools: TOOLS,
  messages: [
    { role: "user", content: "כמה שולחנות יש היום מהשעה 17:00?" },
    {
      role: "assistant",
      content: [
        { type: "tool_use", id: "toolu_test1", name: "tabit_read_day", input: { day: "today", from: "17:00" } },
      ],
    },
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "toolu_test1", content: JSON.stringify(toolResult) },
      ],
    },
  ],
});

const reply = resp.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n").trim();

let pass = 0;
const fails: string[] = [];
const t = (name: string, ok: boolean) => (ok ? pass++ : fails.push(name));

t("הבלוק המוכן הודבק כמו שהוא", reply.includes(rendered));
t("כל שש ההזמנות מופיעות", ROWS.every((r) => reply.includes(r.name!)));
t("אין טבלת markdown", !/^\s*\|.*\|\s*$/m.test(reply));
t("ספירת הפיקדונות היא של הקוד", reply.includes("❌ 2 הזמנות חסרות פיקדון"));
t("לא המציא ספירה משלו", !/[3-9] הזמנות (ללא|חסרות) פיקדון/.test(reply.replace("❌ 2 הזמנות חסרות פיקדון", "")));
t("היום מצוין בתשובה", reply.includes("להיום") || reply.includes("היום"));

console.log("\n--- תשובת המודל ---\n" + reply + "\n-------------------\n");
if (fails.length) for (const f of fails) console.log(`  ❌ ${f}`);
console.log(`${pass} עברו, ${fails.length} נכשלו`);
process.exit(fails.length ? 1 : 0);
