/**
 * סוללת הערכה למעבדת טאביט.
 *
 * מריצה את **המודל האמיתי** עם הפרומפט האמיתי, אבל מול שכבת כלים מדומה עם
 * נתונים קבועים. כך אפשר לבדוק את מה שאי אפשר לבדוק אחרת: האם המודל בחר את
 * הכלי הנכון, והאם הוא הציג את המספר שהכלי החזיר או המציא אחד.
 *
 * כל תרחיש כאן הוא כשל שקרה באמת מול הצוות, או מלכודת שאנחנו יודעים שהיא
 * מפילה מודלים. במיוחד: **צבירה של תקופה שמוצגת כמספר של יום** (23.9, 24.9).
 *
 * אין כאן רשת מול טאביט ואין סוכן מקומי, ולכן ההרצה זהה בכל פעם ואפשר להריץ
 * אותה אחרי כל שינוי בפרומפט. עולה קריאות מודל בלבד.
 *
 * הרצה: NODE_OPTIONS=--use-system-ca npx tsx scripts/lab-eval.mts
 *        npx tsx scripts/lab-eval.mts --only=תקופה   (סינון לפי שם תרחיש)
 */
import { readFileSync } from "fs";

// טעינת .env.local בלי תלות חיצונית. ⚠️ לקובץ יש BOM, ולכן המפתח הראשון נקרא
// עם תו בלתי נראה בתחילתו אם לא מסירים אותו - וזה נראה בדיוק כמו מפתח חסר.
try {
  const rawFile = readFileSync(".env.local", "utf8");
  const raw = rawFile.charCodeAt(0) === 0xfeff ? rawFile.slice(1) : rawFile;
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch { /* אין קובץ - אולי המשתנים כבר בסביבה */ }

const { runTabitChat } = await import("../src/lib/tabit-lab");
import { renderReservationList, type TabitResRow } from "../src/lib/tabit-format";
import { todayIL, addDaysISO, weekdayHe } from "../src/lib/tabit-lab-smart";
import { dayLabelHe } from "../src/lib/tabit-lab-data";

const TODAY = todayIL();
const TOMORROW = addDaysISO(TODAY, 1);
const YESTERDAY = addDaysISO(TODAY, -1);
const short = (iso: string) => { const [, m, d] = iso.split("-").map(Number); return `${d}.${m}`; };

/**
 * שעון קבוע: 14:00 של היום, בשעון ישראל.
 *
 * בלי זה הסוללה נכשלת כשמריצים אותה בין חצות לחמש, כי שער העמימות נכנס
 * ומחזיר שאלת הבהרה במקום תשובה. זו התנהגות נכונה בייצור וקוץ בבדיקות.
 */
const NOW_MS = new Date(`${TODAY}T14:00:00+03:00`).getTime();

// ===== נתוני הדמה =====
// מספרים מכוונים להיות ייחודיים, כדי שהמצאה תיראה מיד.

const TOMORROW_ROWS: TabitResRow[] = [
  { id: "r1", name: "דנה לוי", phone: "0501112222", seats: 4, day: TOMORROW, time: "12:30", tables: [12], deposit: "none" },
  { id: "r2", name: "שלומי כהן", phone: "0528487546", seats: 6, day: TOMORROW, time: "19:00", tables: [31, 32], deposit: "secured" },
  { id: "r3", name: "יונתן ברק", phone: "0533334444", seats: 11, day: TOMORROW, time: "19:30", tables: [69, 70], deposit: "missing", notes: "יום הולדת" },
  { id: "r4", name: "מיטל אבן", phone: "0544445555", seats: 9, day: TOMORROW, time: "20:30", tables: [40, 41], deposit: "missing" },
  { id: "r5", name: "רון סלע", phone: "0555556666", seats: 2, day: TOMORROW, time: "21:00", tables: [7], deposit: "none" },
];

// הזמנות מחר מ-19:00 הן r2,r3,r4,r5: 4 הזמנות ו-28 סועדים. זה המספר שתרחיש
// טווח השעות בודק, ולכן הוא לא אמור להשתנות בלי כוונה.

const dayView = (rows: TabitResRow[], day: string, title: string, all: TabitResRow[], noun?: string) => ({
  day, weekday_he: weekdayHe(day), day_label: dayLabelHe(day), scope_kind: "day",
  count: rows.length,
  covers: rows.reduce((s, r) => s + (r.seats ?? 0), 0),
  secured: rows.filter((r) => r.deposit === "secured").length,
  missing_deposit: rows.filter((r) => r.deposit === "missing").length,
  no_deposit_required: rows.filter((r) => r.deposit === "none").length,
  reservations: rows,
  rendered: renderReservationList({ title, dayISO: day, list: rows, summaryNoun: noun, covers: rows.reduce((s, r) => s + (r.seats ?? 0), 0) }),
  day_totals: {
    count: all.length,
    covers: all.reduce((s, r) => s + (r.seats ?? 0), 0),
    secured: all.filter((r) => r.deposit === "secured").length,
    missing_deposit: all.filter((r) => r.deposit === "missing").length,
    no_deposit_required: all.filter((r) => r.deposit === "none").length,
  },
  source: "snapshot", data_age_minutes: 3,
});

/** אתמול: 4 אי-הגעות, 9 ביטולים, 31 הגיעו. שונה בכוונה מאוד מהצבירה החודשית. */
const YESTERDAY_OUTCOME = {
  day: YESTERDAY, weekday_he: weekdayHe(YESTERDAY), day_label: dayLabelHe(YESTERDAY),
  scope_kind: "day", source: "archive",
  // המספרים שהצוות רואה במסנני טאביט. הפירוק מתחתם.
  no_show: 16, cancelled: 9,
  no_show_reservations: 4, no_show_walkins: 12,
  cancelled_without_customer: 7,
  booked_total: 44, arrived: 31, walk_ins: 52,
  no_show_rate_pct: 9.1,
  covers: { no_show: 14, cancelled: 27, arrived: 96, walk_ins: 110 },
  no_show_list: [
    { id: "n1", day: YESTERDAY, time: "20:00", name: "אורי גל", phone: "0501234567", seats: 4, tables: [22] },
    { id: "n2", day: YESTERDAY, time: "21:00", name: "נועה שמש", phone: "0507654321", seats: 2, tables: [9] },
  ],
  cancelled_list: [
    { id: "c1", day: YESTERDAY, time: "19:00", name: "טל רון", phone: "0509999999", seats: 5, tables: [33] },
  ],
  counting_note: 'no_show (16) ו-cancelled (9) הם בדיוק מה שמופיע במסנני "לקוח לא הגיע" ו"לקוח ביטל" בטאביט - אלה המספרים לענות בהם.',
};

/** צבירה חודשית: המספרים שהמודל הציג בטעות כיום בודד. */
const PERIOD_SUMMARY = {
  scope_kind: "period", is_period_aggregate: true,
  window_from: addDaysISO(TODAY, -30), window_to: TODAY, window_days: 30,
  window_note: "⚠️ המספרים האלה הם צבירה של 30 ימים. אסור להציג אותם כמספרים של יום בודד.",
  booked_total: 296, no_show: 14, cancelled: 46, completed: 236, walk_ins: 1204,
  no_show_rate_pct: 4.7,
  repeat_no_show_customers: [{ phone: "0501234567", name: "אורי גל", no_shows: 3 }],
};

// ===== שכבת הכלים המדומה =====

const label: Record<string, string> = {
  tabit_read_day: "הזמנות היום", tabit_big_tables: "שולחנות גדולים",
  tabit_covers_summary: "ספירת סועדים", tabit_deposit_summary: "פיקדונות",
  tabit_day_outcome: "אי-הגעות וביטולים ליום", tabit_no_show_summary: "אי-הגעות וביטולים לתקופה",
  tabit_revenue: "הכנסות", tabit_find_reservation: "חיפוש הזמנה",
  tabit_table_schedule: "לוח שולחן", tabit_check_availability: "בדיקת זמינות",
  tabit_booking_sources: "מקורות הזמנה", tabit_tables_status: "מצב רצפה",
};

const called: { tool: string; input: Record<string, unknown> }[] = [];

function resolve(day: unknown): string {
  const s = String(day ?? "today");
  if (s === "today") return TODAY;
  if (s === "tomorrow") return TOMORROW;
  if (s === "yesterday") return YESTERDAY;
  return s;
}

async function mockTool(name: string, input: Record<string, unknown>) {
  called.push({ tool: name, input });
  const prov = { toolLabel: label[name] ?? name, scopeLabel: "", source: "snapshot" as const };
  const day = resolve(input.day);

  const inRange = (rows: TabitResRow[]) => {
    const from = typeof input.from === "string" ? input.from : "";
    const to = typeof input.to === "string" ? input.to : "";
    return rows.filter((r) => (!from || (r.time ?? "") >= from) && (!to || (r.time ?? "") <= to));
  };
  const rowsOf = (d: string) => (d === TOMORROW ? TOMORROW_ROWS : []);

  switch (name) {
    case "tabit_read_day":
      return { result: dayView(inRange(rowsOf(day)), day, "כל ההזמנות", rowsOf(day)), provenance: prov };
    case "tabit_covers_summary":
      return { result: dayView(inRange(rowsOf(day)), day, "הזמנות", rowsOf(day)), provenance: prov };
    case "tabit_big_tables": {
      const min = Number(input.min) || 8;
      return { result: dayView(inRange(rowsOf(day)).filter((r) => (r.seats ?? 0) >= min), day, "שולחנות גדולים", rowsOf(day), "שולחנות גדולים"), provenance: prov };
    }
    case "tabit_deposit_summary":
      return { result: dayView(rowsOf(day).filter((r) => r.deposit === "missing"), day, "חסרי פיקדון", rowsOf(day)), provenance: prov };
    case "tabit_day_outcome":
      if (day !== YESTERDAY) {
        // יום שאין עליו נתונים בכלל (למשל יום סגור). אפס אמיתי, לא "לא נבדק".
        return { result: { day, scope_kind: "day", source: "archive", no_show: 0, cancelled: 0, booked_total: 0, arrived: 0, walk_ins: 0 }, provenance: prov };
      }
      return { result: YESTERDAY_OUTCOME, provenance: prov };
    case "tabit_no_show_summary":
      return { result: PERIOD_SUMMARY, provenance: prov };
    case "tabit_revenue":
      return input.day
        ? { result: { scope_kind: "day", day, source: "archive", orders: 137, covers: 289, revenue_ils: 18432.5, tips_ils: 1922, avg_check_ils: 134.5, per_person_ils: 63.8, tip_pct: 10.4 }, provenance: prov }
        : { result: { scope_kind: "period", is_period_aggregate: true, window_from: addDaysISO(TODAY, -7), window_to: TODAY, window_note: "⚠️ צבירה של 7 ימים.", orders: 941, revenue_ils: 126900 }, provenance: prov };
    case "tabit_find_reservation": {
      const q = String(input.name ?? "");
      const matches = TOMORROW_ROWS.filter((r) => (r.name ?? "").includes(q));
      return {
        result: {
          scope_kind: "search", scope: input.day ? dayLabelHe(day) : "כל הימים הקרובים",
          count: matches.length, matches,
          rendered: renderReservationList({ title: `הזמנות שנמצאו על השם "${q}"`, dayISO: TOMORROW, list: matches }),
          source: "snapshot",
        },
        provenance: prov,
      };
    }
    case "tabit_table_schedule": {
      const tables = (input.tables as number[]) ?? [];
      const matches = TOMORROW_ROWS.filter((r) => r.tables?.some((t) => tables.includes(t)));
      return {
        result: {
          tables, scope_kind: "search", scope: input.day ? dayLabelHe(day) : "כל הימים הקרובים",
          count: matches.length, reservations: matches,
          rendered: renderReservationList({ title: `הזמנות על שולחן ${tables.join(",")}`, dayISO: TOMORROW, list: matches }),
          now_seated: [], source: "snapshot",
        },
        provenance: prov,
      };
    }
    case "tabit_check_availability":
      return { result: { date: input.date, time: input.time, seats: input.seats, available: true, free_tables: [{ number: 52, seats: 8, area: "חוץ" }], fits_single: [52], needs_combo: false, recommended: [52] }, provenance: prov };
    default:
      return { result: { error: `כלי ${name} לא מוגדר בסוללת ההערכה` }, provenance: prov };
  }
}

// ===== התרחישים =====

interface Scenario {
  name: string;
  /** שיחה: כל תור הוא הודעת משתמש. תשובות הביניים נשמרות אוטומטית. */
  turns: string[];
  expectTools?: string[];
  forbidTools?: string[];
  /** חייב להופיע בתשובה האחרונה */
  must?: (string | RegExp)[];
  /** אסור שיופיע בתשובה האחרונה */
  mustNot?: (string | RegExp)[];
}

const SCENARIOS: Scenario[] = [
  {
    // ⭐ התקלה שהתחילה את הכל (24.9): צבירה חודשית שהוצגה כיום בודד.
    name: "יום בודד: אי-הגעות וביטולים בתאריך מפורש",
    turns: [`כמה אי הגעות וביטולים היו ב-${short(YESTERDAY)}?`],
    expectTools: ["tabit_day_outcome"],
    forbidTools: ["tabit_no_show_summary"],
    // 16 ו-9 הם מה שהצוות רואה במסנני טאביט, ולכן זו התשובה.
    must: [/\b16\b/, /\b9\b/],
    mustNot: [/\b46\b/, /\b296\b/, /לא יכול/, /אי אפשר/],
  },
  {
    name: "יום בודד: אתמול במילים",
    turns: ["כמה אי-הגעות היו אתמול?"],
    expectTools: ["tabit_day_outcome"],
    forbidTools: ["tabit_no_show_summary"],
    must: [/\b16\b/],
    // החתימה של הצבירה החודשית היא 46 הביטולים ו-296 ההזמנות.
    mustNot: [/\b46\b/, /\b296\b/],
  },
  {
    name: "יום בודד: מי בדיוק לא הגיע",
    turns: [`מי לא הגיע ב-${short(YESTERDAY)}?`],
    expectTools: ["tabit_day_outcome"],
    must: ["אורי גל", "נועה שמש"],
  },
  {
    // צבירה לגיטימית, אבל חייבת להיות מסומנת ככזו ולא להיקרא כיום.
    name: "תקופה: נותנים מספר, ואומרים על איזה טווח",
    turns: ["כמה אי-הגעות היו בחודש האחרון?"],
    expectTools: ["tabit_no_show_summary"],
    must: [/\b14\b/, /30|חודש|\d{1,2}\.\d{1,2}/],
  },
  {
    // ⭐ הפירוק קיים, אבל הוא תשובת המשך ולא התשובה. המספר הראשון שנאמר
    // חייב להיות המספר שעל המסך של הצוות.
    name: "הפירוק מגיע רק כששואלים עליו",
    turns: [`כמה אי-הגעות היו ב-${short(YESTERDAY)}?`, "וכמה מהן היו הזמנות מראש ולא מזדמנים?"],
    must: [/\b4\b/],
  },
  {
    name: "רשימת יום: הבלוק המוכן מודבק כמו שהוא",
    turns: ["מה ההזמנות של מחר?"],
    expectTools: ["tabit_read_day"],
    must: ["דנה לוי", "שלומי כהן", "יונתן ברק", "מיטל אבן", "רון סלע", "5 הזמנות"],
  },
  {
    name: "פיקדונות: 'חסר' ו'ללא' אינם אותו דבר",
    turns: ["מי לא שילם פיקדון מחר?"],
    expectTools: ["tabit_deposit_summary"],
    must: ["יונתן ברק", "מיטל אבן"],
    mustNot: ["רון סלע", "דנה לוי"],
  },
  {
    name: "טווח שעות: 'מהשעה' הוא טווח ולא נקודה",
    turns: ["כמה אנשים יש מחר מהשעה 19:00?"],
    must: [/28/],
    mustNot: [/\b6\b סועדים/],
  },
  {
    name: "שולחנות גדולים: לא מסתירים את סך היום",
    turns: ["כמה שולחנות גדולים יש מחר?"],
    expectTools: ["tabit_big_tables"],
    must: [/\b2\b/, "יונתן ברק", "מיטל אבן"],
  },
  {
    name: "חיפוש: לא שואלים יום לפני שמחפשים",
    turns: ["תמצא לי את ההזמנה של מיטל"],
    expectTools: ["tabit_find_reservation"],
    must: ["מיטל אבן"],
    mustNot: [/באיזה יום\?$/],
  },
  {
    name: "המשכיות: 'הטלפון שלה' מתייחס לתשובה הקודמת",
    turns: ["תמצא לי את ההזמנה של מיטל", "ומה הטלפון שלה?"],
    must: [/054-?444-?5555|0544445555/],
  },
  {
    name: "שולחן: נבדק דרך הכלי, לא בסריקה ידנית",
    turns: ["יש הזמנות על שולחן 70?"],
    expectTools: ["tabit_table_schedule"],
    must: ["יונתן ברק"],
  },
  {
    // "אין" מותר, אבל רק אחרי בדיקה, ועם ציון הטווח שנבדק.
    name: "שולחן ריק: 'אין' רק אחרי שהכלי רץ",
    turns: ["יש הזמנות על שולחן 99?"],
    expectTools: ["tabit_table_schedule"],
    must: [/אין|לא נמצא|0/],
  },
  {
    name: "הכנסות של יום מסוים",
    turns: ["כמה עשינו אתמול?"],
    expectTools: ["tabit_revenue"],
    must: [/18,?432|18432/],
    mustNot: [/126,?900/],
  },
  {
    name: "כתיבה מושבתת: אומרים שלא זמין, בלי להתנצל בארוכה",
    turns: ["תבטל את ההזמנה של מיטל מחר"],
    forbidTools: ["tabit_cancel_reservation"],
    must: [/זמינ|מושבת|לא ניתן|לא אפשרי/],
  },
  {
    // חוסר כיסוי הוא לא "אפס".
    // יום ישן נקרא כמו כל יום אחר. אפס אמיתי (יום סגור) מותר לומר, כל עוד
    // הוא בא מכלי שרץ ולא מהנחה.
    name: "יום ישן נקרא כרגיל",
    turns: ["כמה אי-הגעות היו ב-10.9?"],
    expectTools: ["tabit_day_outcome"],
    mustNot: [/לא יכול|אי אפשר לבדוק|לא זמין/],
  },
];

// ===== הרצה =====

const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const list = only ? SCENARIOS.filter((s) => s.name.includes(only)) : SCENARIOS;

let passed = 0;
const failures: string[] = [];

for (const s of list) {
  called.length = 0;
  const history: { role: "user" | "assistant"; content: string }[] = [];
  let reply = "";
  const started = Date.now();
  try {
    for (const turn of s.turns) {
      history.push({ role: "user", content: turn });
      const r = await runTabitChat(history, { toolRunner: mockTool, withSourceFooter: false, nowMs: NOW_MS });
      reply = r.reply;
      history.push({ role: "assistant", content: reply });
    }
  } catch (e) {
    failures.push(`${s.name}\n     💥 ${e instanceof Error ? e.message : e}`);
    console.log(`  ❌ ${s.name} (שגיאה)`);
    continue;
  }

  const problems: string[] = [];
  const tools = called.map((c) => c.tool);
  for (const want of s.expectTools ?? []) if (!tools.includes(want)) problems.push(`לא נקרא הכלי ${want} (נקראו: ${tools.join(", ") || "כלום"})`);
  for (const bad of s.forbidTools ?? []) if (tools.includes(bad)) problems.push(`נקרא כלי אסור: ${bad}`);
  for (const m of s.must ?? []) {
    const ok = typeof m === "string" ? reply.includes(m) : m.test(reply);
    if (!ok) problems.push(`חסר בתשובה: ${m}`);
  }
  for (const m of s.mustNot ?? []) {
    const bad = typeof m === "string" ? reply.includes(m) : m.test(reply);
    if (bad) problems.push(`הופיע בתשובה ואסור: ${m}`);
  }

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (problems.length) {
    failures.push(`${s.name}\n     ${problems.join("\n     ")}\n     כלים: ${tools.join(", ") || "כלום"}\n     תשובה: ${reply.replace(/\n/g, " ⏎ ").slice(0, 400)}`);
    console.log(`  ❌ ${s.name}  (${secs}ש)`);
  } else {
    passed++;
    console.log(`  ✅ ${s.name}  (${secs}ש)`);
  }
}

if (failures.length) {
  console.log(`\n${failures.length} תרחישים נכשלו:\n`);
  for (const f of failures) console.log(`  ❌ ${f}\n`);
}
console.log(`\n${passed}/${list.length} תרחישים עברו`);
process.exit(failures.length ? 1 : 0);
