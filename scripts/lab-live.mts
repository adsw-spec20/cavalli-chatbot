/**
 * בדיקת עשן חיה למעבדת טאביט - הקוד החדש מול הנתונים האמיתיים.
 *
 * רצה מקומית אבל מדברת אל מסד הנתונים של הייצור, ולכן גם אל תור הפקודות
 * שהסוכן המקומי מושך ממנו. כלומר: זו הדרך לבדוק את המסלול המלא **לפני**
 * פריסה, כולל טאביט עצמו.
 *
 * קריאה בלבד מול טאביט. כן נוצרות שיחות מעבדה אמיתיות בהיסטוריה - לא, הן לא
 * נוצרות: הסקריפט קורא ישירות ל-runTabitChat ולא דרך ה-API, ולכן שום דבר לא
 * נשמר בהיסטוריית השיחות.
 *
 * הרצה:
 *   LAB_ENV=<נתיב ל-prod.env> NODE_OPTIONS=--use-system-ca npx tsx scripts/lab-live.mts
 *   ...--only=פיקדון   לסינון תרחישים
 */
import { readFileSync } from "fs";

function loadEnv(path: string) {
  let text: string;
  try { text = readFileSync(path, "utf8"); } catch { return false; }
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return true;
}

const envFile = process.env.LAB_ENV || "";
if (envFile && !loadEnv(envFile)) console.log(`⚠ לא נמצא ${envFile}`);
loadEnv(".env.local");

if (!process.env.DATABASE_URL) {
  console.log("חסר DATABASE_URL - בלי זה הבדיקה רצה מול אחסון הקובץ המקומי, שבו אין נתוני טאביט.");
  console.log("הרץ: vercel env pull <קובץ> --environment=production  ואז LAB_ENV=<אותו קובץ>");
  process.exit(1);
}

const { runTabitChat } = await import("../src/lib/tabit-lab");
const { todayIL, addDaysISO } = await import("../src/lib/tabit-lab-smart");

const TODAY = todayIL();
const YESTERDAY = addDaysISO(TODAY, -1);
const TOMORROW = addDaysISO(TODAY, 1);
const short = (iso: string) => { const [, m, d] = iso.split("-").map(Number); return `${d}.${m}`; };
/** שעון קבוע (14:00 היום) כדי ששער החצות לא יתפוס תרחישים שאינם עליו */
const NOON = new Date(`${TODAY}T14:00:00+03:00`).getTime();

interface Live {
  name: string;
  q: string;
  /** שעון מוזרק. undefined = השעון האמיתי (לבדיקת שער החצות) */
  at?: number;
  expectTools?: string[];
  forbidTools?: string[];
  mustNot?: RegExp[];
  must?: RegExp[];
}

const SCENARIOS: Live[] = [
  { name: "רשימת יום (מהתצלום, אמור להיות מהיר)", q: `מה ההזמנות של ${short(TOMORROW)}?`, expectTools: ["tabit_read_day"] },
  { name: "פיקדונות חסרים להיום", q: `מי לא שילם פיקדון ב-${short(TODAY)}?`, at: NOON, expectTools: ["tabit_deposit_summary"] },
  {
    // ⭐ התקלה המקורית, מול נתוני אמת.
    name: "אי-הגעות וביטולים ליום מסוים",
    q: `כמה אי הגעות וביטולים היו ב-${short(YESTERDAY)}?`,
    at: NOON,
    expectTools: ["tabit_day_outcome"],
    forbidTools: ["tabit_no_show_summary"],
    mustNot: [/לא יכול|אי אפשר|לפני למעלה מחודש/],
  },
  { name: "מי בדיוק לא הגיע", q: `מי לא הגיע ב-${short(YESTERDAY)}?`, at: NOON, expectTools: ["tabit_day_outcome"] },
  { name: "הכנסות של יום", q: `כמה עשינו ב-${short(YESTERDAY)}?`, at: NOON, expectTools: ["tabit_revenue"] },
  { name: "מקורות הזמנה ליום", q: `מאיפה הגיעו ההזמנות של ${short(YESTERDAY)}?`, at: NOON, expectTools: ["tabit_booking_sources"] },
  { name: "צבירה: חייב לומר טווח", q: "כמה אי-הגעות היו בחודש האחרון?", at: NOON, expectTools: ["tabit_no_show_summary"], must: [/\d{1,2}\.\d{1,2}|30|חודש/] },
  { name: "מצב רצפה עכשיו (חי)", q: "מה מצב השולחנות עכשיו?", at: NOON, expectTools: ["tabit_tables_status"] },
  { name: "לוח שולחן בלי יום", q: "יש הזמנות על שולחן 70?", at: NOON, expectTools: ["tabit_table_schedule"] },
  { name: "שולחנות גדולים", q: `כמה שולחנות גדולים יש ב-${short(TOMORROW)}?`, at: NOON, expectTools: ["tabit_big_tables"] },
  { name: "חוסר כיסוי בארכיון: לא 'אפס'", q: "כמה אי-הגעות היו ב-1.3?", at: NOON, mustNot: [/^אפס|אין אי-הגעות|לא היו אי-הגעות/] },
  { name: "שער החצות (שעון אמיתי)", q: "כמה אי הגעות היו אתמול?" },
];

const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const list = only ? SCENARIOS.filter((s) => s.name.includes(only)) : SCENARIOS;

let ok = 0;
const bad: string[] = [];

for (const s of list) {
  const started = Date.now();
  console.log(`\n${"─".repeat(70)}\n🧪 ${s.name}\n   ❓ ${s.q}`);
  try {
    const r = await runTabitChat([{ role: "user", content: s.q }], s.at ? { nowMs: s.at } : undefined);
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    const tools = r.toolLog.map((t) => `${t.tool}${t.ok ? "" : " ❌"}(${JSON.stringify(t.params)}) ${t.ms}ms`);
    console.log(`   🔧 ${tools.join("\n      ") || "(בלי כלים)"}`);
    console.log(`   💬 ${r.reply.replace(/\n/g, "\n      ")}`);
    console.log(`   ⏱  ${secs} שניות`);

    const names = r.toolLog.map((t) => t.tool);
    const problems: string[] = [];
    for (const w of s.expectTools ?? []) if (!names.includes(w)) problems.push(`לא נקרא ${w}`);
    for (const b of s.forbidTools ?? []) if (names.includes(b)) problems.push(`נקרא כלי אסור ${b}`);
    for (const m of s.must ?? []) if (!m.test(r.reply)) problems.push(`חסר: ${m}`);
    for (const m of s.mustNot ?? []) if (m.test(r.reply)) problems.push(`אסור והופיע: ${m}`);
    for (const t of r.toolLog) if (!t.ok) problems.push(`כלי נכשל: ${t.tool} - ${t.error}`);

    if (problems.length) { bad.push(`${s.name}: ${problems.join(" | ")}`); console.log(`   ⚠ ${problems.join(" | ")}`); }
    else ok++;
  } catch (e) {
    bad.push(`${s.name}: 💥 ${e instanceof Error ? e.message : e}`);
    console.log(`   💥 ${e instanceof Error ? e.message : e}`);
  }
}

console.log(`\n${"═".repeat(70)}\n${ok}/${list.length} תרחישים עברו`);
if (bad.length) { console.log("\nבעיות:"); for (const b of bad) console.log(`  ❌ ${b}`); }
process.exit(bad.length ? 1 : 0);
