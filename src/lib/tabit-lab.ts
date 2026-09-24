import Anthropic from "@anthropic-ai/sdk";
import { runCommand, type TabitAction } from "./tabit-queue";
import { recordLlmUsage } from "./usage";
import { loadBusinessConfig } from "./business-config-store";
import { renderByDay } from "./tabit-format";
import { labDayContext } from "./day-context";
import {
  calendarBlock, hoursBlock, checkOpenAt, resolveDayISO, weekdayHe, todayIL,
  loadSnapshot, snapshotAgeMinutes, filterRows, rowOut, type LabResRow,
} from "./tabit-lab-smart";
import {
  buildDayView, cachedAgentCall, allUpcomingRows, dayLabelHe, buildSourceFooter,
  TOOL_LABEL_HE, type Provenance,
} from "./tabit-lab-data";
import { LAB_SYSTEM, LAB_WRITE_RULES, LAB_READ_ONLY_NOTE } from "./tabit-lab-prompt";
import {
  readLedgerDay, ledgerIsComplete, computeDayOutcome, computeRevenue, computeSources,
} from "./tabit-ledger";

/**
 * לולאת השיחה מול טאביט - משותפת לשני משטחי הגישה: מעבדת הצ'אט בפאנל
 * (testchat) ובוט הקבוצה בוואטסאפ (Green API). מבודדת לגמרי מהצ'אטבוט הציבורי.
 *
 * שלב 1: פעולות כתיבה (יצירה/שינוי/ביטול) מושבתות. נחשפות למודל רק אם
 * TABIT_WRITES_ENABLED="true", ובוט הקבוצה כופה קריאה-בלבד תמיד (forceReadOnly).
 * הגנת עומק: dispatch חוסם, והסוכן המקומי (agent.js) חוסם שוב מול טאביט.
 */

/**
 * מודל ייעודי לטאביט, נפרד מהבוט הציבורי.
 *
 * עד 24.9 ברירת המחדל הייתה Haiku, בנימוק שזו סביבה פנימית וזול. זה היה
 * חיסכון במקום הלא נכון: הצוות קיבל תאריכים מסולפים ומספר של תקופה שהוצג
 * כמספר של יום, ואיבד אמון בכלי. הנפח כאן הוא עשרות הודעות ביום מול מנהל אחד,
 * וההפרש בעלות זניח מול המחיר של תשובה שגויה על רצפת המסעדה.
 */
const MODEL = process.env.TABIT_LAB_MODEL ?? "claude-sonnet-5";

/** כמה סבבי כלים מותר בשיחה אחת לפני שעוצרים */
const MAX_TOOL_ROUNDS = 6;

function israelNow(): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem", weekday: "long", year: "numeric", month: "long",
    day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date());
}

const DAY_ARG = 'day = "today" | "tomorrow" | "yesterday" | "YYYY-MM-DD".';

/**
 * הארכיון של טאביט מוגבל ב**גודל החלון** (24 שעות), לא בכמה אחורה אפשר ללכת.
 * הפרמטר שסוגר את החלון נקרא `until`; שליחת `to` נבלעת בשקט והבקשה נדחית.
 * לכן יום בודד, גם ישן, נקרא בבקשה אחת, ותקופה נקראת יום-יום.
 */
const PERIOD_NOTE = "תקופה נקראת יום-יום מהארכיון, ולכן חודש לוקח כמה עשרות שניות. התקרה היא 31 ימים בבקשה אחת.";

export const TOOLS: Anthropic.Tool[] = [
  { name: "tabit_health", description: "בדוק את החיבור לטאביט: טוען נתונים ומחזיר כמה הזמנות נטענו וגרסת שרת. השתמש כשמבקשים לוודא שהחיבור עובד.", input_schema: { type: "object", properties: {} } },

  { name: "tabit_read_day", description: `כל ההזמנות של יום. ${DAY_ARG} ימי עבר נקראים מהארכיון אוטומטית. from/to (HH:MM) מסננים טווח שעות **בקוד** - "מהשעה 17:00" = from "17:00" בלי to. מחזיר count, covers, day_totals, ו-rendered: הרשימה המלאה מוכנה להדבקה.`, input_schema: { type: "object", properties: { day: { type: "string" }, from: { type: "string", description: "HH:MM - כולל והלאה" }, to: { type: "string", description: "HH:MM - עד וכולל" } }, required: ["day"] } },

  { name: "tabit_big_tables", description: `שולחנות גדולים ליום - מסונן, ממוין וספור **בקוד**. ברירת מחדל 8+ סועדים (min אחר אפשרי). מחזיר count, covers, missing_deposit, day_totals (היום כולו) ו-rendered. הכלי הנכון לכל שאלה על "הזמנות גדולות". ${DAY_ARG}`, input_schema: { type: "object", properties: { day: { type: "string" }, min: { type: "number" }, from: { type: "string" }, to: { type: "string" } }, required: ["day"] } },

  { name: "tabit_covers_summary", description: `כמה סועדים וכמה הזמנות יש ביום, אופציונלית בטווח שעות (ערב = from "18:00"; צהריים = to "18:00"). count ו-covers מחושבים בקוד - קח אותם כמו שהם. הכלי לכל שאלת "כמה אנשים/מוזמנים". ${DAY_ARG}`, input_schema: { type: "object", properties: { day: { type: "string" }, from: { type: "string" }, to: { type: "string" } }, required: ["day"] } },

  { name: "tabit_deposit_summary", description: `סיכום פיקדונות ליום: כמה מובטחים, כמה חסרים, כמה לא נדרשו, ורשימת החסרים מוכנה להדבקה. ${DAY_ARG}`, input_schema: { type: "object", properties: { day: { type: "string" } }, required: ["day"] } },

  { name: "tabit_get_deposit_link", description: "שלוף את קישור הפיקדון של הזמנה לפי reservationId.", input_schema: { type: "object", properties: { reservationId: { type: "string" } }, required: ["reservationId"] } },

  { name: "tabit_find_reservation", description: "מציאת הזמנה לפי שם ו/או טלפון (אפשר חלקי). החיפוש גמיש (רישיות/רווחים/קידומות) ומבוצע בקוד. **זה הכלי לכל 'תמצא לי את ההזמנה של X'** - אל תסרוק read_day בעצמך. בלי day הוא מכסה את כל הימים הקרובים. אם צוין day ולא נמצא בו, מחזיר איפה כן נמצא (found_on_other_days).", input_schema: { type: "object", properties: { name: { type: "string" }, phone: { type: "string" }, day: { type: "string" } } } },

  { name: "tabit_table_schedule", description: "כל ההזמנות המשויכות לשולחן/שולחנות מסוימים (למשל [69,70]), ליום נתון או לכל הימים הקרובים. **הכלי היחיד לשאלות 'מה יש על שולחן X'** - לעולם אל תענה על שולחן ספציפי מסריקה ידנית. לא צוין יום? אל תעביר day בכלל. מחזיר גם מי יושב שם עכשיו.", input_schema: { type: "object", properties: { tables: { type: "array", items: { type: "number" } }, day: { type: "string" } }, required: ["tables"] } },

  { name: "tabit_check_availability", description: "בדוק אם יש מקום פנוי לקבוצה בשעה ותאריך נתונים. seating (inside/outside) **חובה אם הלקוח ציין פנים/חוץ**, אחרת הבדיקה עלולה להחזיר שולחן מהאזור הלא נכון. מחזיר את כל השולחנות הפנויים במשבצת (free_tables), האם מתאים שולחן בודד (fits_single) או שצריך צירוף (needs_combo). שעה מחוץ לשעות הפתיחה נחסמת בקוד ומחזירה closed_at_requested_time. לא יוצר כלום.", input_schema: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD" }, time: { type: "string", description: "HH:MM" }, seats: { type: "number" }, seating: { type: "string", enum: ["inside", "outside"] } }, required: ["date", "time", "seats"] } },

  { name: "tabit_tables_status", description: "מצב השולחנות החי כרגע (נקרא תמיד חי מטאביט): כמה פנויים, תפוסים, מלוכלכים, סה\"כ מקומות. occupied_detail נותן לכל שולחן תפוס כמה זמן יושבים, כמה נשאר ודגל - זה מה שעונה על \"מתי יתפנה שולחן\".", input_schema: { type: "object", properties: {} } },

  { name: "tabit_customer_lookup", description: `פרופיל לקוח: ההזמנות הקרובות שלו, וביקורים/אי-הגעות מהארכיון. ⚠️ ההיסטוריה נספרת על 14 הימים האחרונים בלבד (history_note אומר את הטווח המדויק) - אל תציג אותה כ"מאז ומתמיד". כדי *למצוא הזמנה* השתמש ב-tabit_find_reservation.`, input_schema: { type: "object", properties: { phone: { type: "string" }, name: { type: "string" } } } },

  { name: "tabit_day_outcome", description: `**אי-הגעות, ביטולים והגעות של יום מסוים** (כל יום בהיסטוריה, לא רק אתמול). הכלי לכל שאלה מהצורה "כמה אי-הגעות/ביטולים היו ב-23.9 / אתמול / ביום שלישי", וגם "מי לא הגיע" / "מי ביטל" (מחזיר רשימות שמיות). **no_show ו-cancelled הם בדיוק המספרים שהצוות רואה במסנני "לקוח לא הגיע" ו"לקוח ביטל" בטאביט** - ענה בהם. הפירוק (הזמנות מול מזדמנים, ביטולים בלי לקוח) נמצא בשדות הנפרדים, לשאלות המשך. ${DAY_ARG}`, input_schema: { type: "object", properties: { day: { type: "string" } }, required: ["day"] } },

  { name: "tabit_no_show_summary", description: `אי-הגעות וביטולים **לאורך תקופה** (ברירת מחדל 30 ימים), כולל לקוחות שלא הגיעו יותר מפעם אחת. ${PERIOD_NOTE} לשאלה על יום בודד השתמש ב-tabit_day_outcome.`, input_schema: { type: "object", properties: { days: { type: "number" } } } },

  { name: "tabit_booking_sources", description: `פילוח מקורות ההזמנות: אונליין, גוגל, טלפון/צוות, הגעה מהרחוב. העבר day ליום מסוים או days לתקופה. ${PERIOD_NOTE} ${DAY_ARG}`, input_schema: { type: "object", properties: { day: { type: "string" }, days: { type: "number" } } } },

  { name: "tabit_revenue", description: `הכנסות מהארכיון: פדיון, טיפים, ממוצע לחשבון וממוצע לסועד. העבר day ליום מסוים או days לתקופה. ${PERIOD_NOTE} ${DAY_ARG}`, input_schema: { type: "object", properties: { day: { type: "string" }, days: { type: "number" } } } },

  { name: "tabit_shift_dashboard", description: `תמונת מצב של משמרת/יום: כמה הזמנות וסועדים, כמה כבר הגיעו וכמה צפויים, מזדמנים, ביטולים, פיקדונות חסרים, תפוסה באחוזים. הכלי ל"מה המצב היום?". ${DAY_ARG}`, input_schema: { type: "object", properties: { day: { type: "string" } }, required: ["day"] } },

  { name: "tabit_notification_status", description: `מה נשלח ללקוח ומתי: האם נשלח קישור פיקדון, האם נשלחה תזכורת, כמה אירועי התראה יש. ליום שלם או להזמנה בודדת (reservationId). ${DAY_ARG}`, input_schema: { type: "object", properties: { day: { type: "string" }, reservationId: { type: "string" } } } },

  { name: "tabit_create_reservation", description: "צור הזמנה חדשה בטאביט. הוספה בלבד - לעולם לא נוגע בהזמנות קיימות. seating: \"inside\"=בפנים, \"outside\"=בחוץ. שיוך השולחן אוטומטי לפי מספר הסועדים, האזור ומה שפנוי. send_deposit_link=true שולח ללקוח SMS עם קישור הפיקדון; false רק מחזיר את הקישור.", input_schema: { type: "object", properties: { name: { type: "string" }, phone: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD" }, time: { type: "string", description: "HH:MM" }, seats: { type: "number" }, seating: { type: "string", enum: ["inside", "outside"], description: "בפנים או בחוץ" }, send_deposit_link: { type: "boolean", description: "האם לשלוח ללקוח SMS עם קישור הפיקדון" } }, required: ["name", "phone", "date", "time", "seats", "seating", "send_deposit_link"] } },

  { name: "tabit_modify_reservation", description: "שנה הזמנה קיימת (כתיבה!). reservation_id מגיע מכלי חיפוש. שלח רק את השדות שמשתנים. השולחנות משויכים מחדש אוטומטית. אסור לקרוא לכלי הזה בלי אישור \"כן\" מפורש על ההזמנה המדויקת.", input_schema: { type: "object", properties: { reservation_id: { type: "string" }, seating: { type: "string", enum: ["inside", "outside"] }, date: { type: "string" }, time: { type: "string" }, seats: { type: "number" } }, required: ["reservation_id"] } },

  { name: "tabit_cancel_reservation", description: "בטל הזמנה קיימת (כתיבה!). אסור לקרוא לכלי הזה בלי אישור \"כן\" מפורש על ההזמנה המדויקת.", input_schema: { type: "object", properties: { reservation_id: { type: "string" } }, required: ["reservation_id"] } },
];

const WRITE_TOOL_NAMES = new Set(["tabit_create_reservation", "tabit_modify_reservation", "tabit_cancel_reservation"]);
const WRITES_ENABLED = process.env.TABIT_WRITES_ENABLED === "true";
const READ_TOOLS: Anthropic.Tool[] = TOOLS.filter((t) => !WRITE_TOOL_NAMES.has(t.name));

const TOOL_TO_ACTION: Record<string, TabitAction> = {
  tabit_health: "health",
  tabit_get_deposit_link: "get_deposit_link",
  tabit_create_reservation: "create_reservation",
  tabit_check_availability: "check_availability",
  tabit_customer_lookup: "customer_lookup",
  tabit_tables_status: "tables_status",
  tabit_day_outcome: "day_outcome",
  tabit_no_show_summary: "no_show_summary",
  tabit_booking_sources: "booking_sources",
  tabit_revenue: "revenue_summary",
  tabit_shift_dashboard: "shift_dashboard",
  tabit_notification_status: "notification_status",
  tabit_modify_reservation: "modify_reservation",
  tabit_cancel_reservation: "cancel_reservation",
};

/** הפרומפט המלא, מיוצא לבדיקת ציות (scripts/lab-format-live-test.mts) */
export const SYSTEM = LAB_SYSTEM;

// ===== כלים דטרמיניסטיים בצד השרת =====

/** שורות הזמנות לחיפוש: יום עבר מהארכיון, אחרת מהתצלום/חי */
async function rowsForSearch(dayISO: string | null): Promise<{ rows: LabResRow[]; source: string; ageMin: number | null }> {
  if (dayISO && dayISO < todayIL()) {
    const res = (await cachedAgentCall("read_day", { day: dayISO }, dayISO)) as { reservations?: LabResRow[] };
    return { rows: res.reservations ?? [], source: "archive", ageMin: null };
  }
  const { rows, source, ageMinutes } = await allUpcomingRows();
  return { rows, source, ageMin: ageMinutes };
}

/** מציאת הזמנה: חיפוש גמיש בקוד; אם צוין יום ולא נמצא בו - מחפש בכל הימים */
async function serverFindReservation(input: Record<string, unknown>): Promise<unknown> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const phone = typeof input.phone === "string" ? input.phone.trim() : "";
  if (!name && !phone) throw new Error("צריך שם או טלפון לחיפוש");
  const dayISO = input.day != null && input.day !== "" ? resolveDayISO(input.day) : null;
  const { rows, source, ageMin } = await rowsForSearch(dayISO);

  const q = { name: name || undefined, phone: phone || undefined };
  const onDay = dayISO ? filterRows(rows, { ...q, day: dayISO }) : filterRows(rows, q);
  const base = {
    scope_kind: "search",
    searched: { name: name || null, phone: phone || null, day: dayISO, weekday_he: dayISO ? weekdayHe(dayISO) : null },
    scope: dayISO ? dayLabelHe(dayISO) : "כל הימים הקרובים",
    source, ...(ageMin != null ? { data_age_minutes: ageMin } : {}),
  };
  if (onDay.length > 0 || !dayISO) {
    const out = onDay.map(rowOut);
    return {
      ...base,
      count: out.length,
      matches: out,
      rendered: renderByDay(out, { title: `הזמנות שנמצאו${name ? ` על השם "${name}"` : ""}` }),
    };
  }
  // לא נמצא ביום המבוקש - מחפשים בכל הימים הקרובים ומדווחים איפה כן
  const elsewhere = filterRows(rows, q).map(rowOut);
  return {
    ...base, count: 0, matches: [],
    found_on_other_days: elsewhere,
    ...(elsewhere.length ? { rendered: renderByDay(elsewhere, { title: "נמצא בימים אחרים" }) } : {}),
    note: elsewhere.length
      ? "לא נמצא ביום המבוקש, אבל נמצאו התאמות בימים אחרים (found_on_other_days) - הצג אותן ואמור באיזה יום"
      : "לא נמצאה שום התאמה גם בשאר הימים הקרובים",
  };
}

/** לוח שולחן: כל ההזמנות על שולחנות נתונים + מי יושב שם עכשיו */
async function serverTableSchedule(input: Record<string, unknown>): Promise<unknown> {
  const tables = Array.isArray(input.tables) ? input.tables.map(Number).filter((n) => Number.isFinite(n)) : [];
  if (!tables.length) throw new Error("צריך לפחות מספר שולחן אחד");
  const dayISO = input.day != null && input.day !== "" ? resolveDayISO(input.day) : null;
  const { rows, source, ageMin } = await rowsForSearch(dayISO);
  const matches = filterRows(rows, { tables, day: dayISO ?? undefined })
    .sort((a, b) => (a.day + a.time < b.day + b.time ? -1 : 1));

  // מי יושב עכשיו על השולחנות (מהמפה החיה) - רלוונטי כשמסתכלים על היום/בלי יום
  let now_seated: unknown[] = [];
  if (!dayISO || dayISO === todayIL()) {
    const snap = await loadSnapshot();
    now_seated = (snap?.floor?.tables ?? [])
      .filter((t) => tables.includes(t.number) && t.current)
      .map((t) => ({ table: t.number, ...t.current }));
  }
  return {
    tables,
    scope_kind: "search",
    day: dayISO, weekday_he: dayISO ? weekdayHe(dayISO) : null,
    scope: dayISO ? dayLabelHe(dayISO) : "כל הימים הקרובים",
    count: matches.length,
    reservations: matches.map(rowOut),
    rendered: renderByDay(matches.map(rowOut), {
      title: `הזמנות על שולחן ${tables.join(",")}`,
      emptyText: "אין הזמנות על השולחנות האלה בטווח שנבדק.",
    }),
    now_seated,
    source, ...(ageMin != null ? { data_age_minutes: ageMin } : {}),
  };
}

// ===== ניתוב הכלים =====

const DAY_VIEW_TOOLS: Record<string, { title: string; summaryNoun?: string }> = {
  tabit_read_day: { title: "כל ההזמנות" },
  tabit_big_tables: { title: "שולחנות גדולים", summaryNoun: "שולחנות גדולים" },
  tabit_covers_summary: { title: "הזמנות" },
  tabit_deposit_summary: { title: "חסרי פיקדון" },
};

/** ימים שהכלי שלהם נקרא מהארכיון ולכן שווה למטמן */
function dayArgOf(input: Record<string, unknown>): string | null {
  const raw = input.day ?? input.date;
  if (raw == null || raw === "") return null;
  return resolveDayISO(raw);
}

export interface DispatchOutcome {
  result: unknown;
  provenance: Provenance;
}

/**
 * ניסיון לענות מהפנקס שלנו לפני שפונים לטאביט.
 *
 * הארכיון של טאביט נגיש ליממה אחת בלבד, ולכן זו הדרך **היחידה** לענות על יום
 * ישן יותר. מוחזר null כשאין פנקס ליום הזה או כשהוא לא אמין (התחלנו לתעד
 * באמצע היום), ואז נופלים חזרה לטאביט - שיגיד בעצמו שאין לו כיסוי.
 */
async function fromLedger(name: string, dayISO: string): Promise<Record<string, unknown> | null> {
  const entry = await readLedgerDay(dayISO);
  if (!entry || !entry.records.length || !ledgerIsComplete(entry)) return null;
  const base = {
    day: dayISO,
    weekday_he: weekdayHe(dayISO),
    day_label: dayLabelHe(dayISO),
    scope_kind: "day",
    source: "ledger",
    ledger_note: "הנתון נשלף מהתיעוד היומי שלנו (טאביט עצמו שומר רק 24 שעות אחורה). הוא נאסף רציף מאותו יום.",
    ...(dayISO === todayIL()
      ? { partial_day: true, partial_note: "היום עוד לא נגמר: הזמנות שטרם הסתיימו לא נספרות כאן, והמספר יגדל עד סוף הערב." }
      : {}),
  };
  if (name === "tabit_day_outcome") return { ...base, ...computeDayOutcome(entry.records, dayISO) };
  if (name === "tabit_revenue") return { ...base, ...computeRevenue(entry.records, dayISO) };
  if (name === "tabit_booking_sources") return { ...base, ...computeSources(entry.records, dayISO) };
  return null;
}

const LEDGER_TOOLS = new Set(["tabit_day_outcome", "tabit_revenue", "tabit_booking_sources"]);

/**
 * קריאה מהפנקס **כבויה כברירת מחדל**.
 *
 * הפנקס נבנה כשחשבנו שטאביט נותן 24 שעות היסטוריה בלבד. מסתבר שהוא נותן הכל
 * (המגבלה היא על גודל החלון, והפרמטר הוא `until`), ולכן הפנקס הפך מ"המקור
 * היחיד" ל"מטמון מהיר יותר". שני מסלולי חישוב לאותה שאלה הם בדיוק הדרך שבה
 * שני מספרים שונים מגיעים לאותו צוות, וזו התקלה שאנחנו מתקנים. האיסוף ממשיך
 * לרוץ כרשת ביטחון למקרה שטאביט יהדק את הגישה, והקריאה תידלק רק אז.
 */
const LEDGER_READS = process.env.TABIT_LEDGER_READS === "true";

async function dispatch(name: string, input: Record<string, unknown>): Promise<DispatchOutcome> {
  const toolLabel = TOOL_LABEL_HE[name] ?? name;

  // --- קריאות יום: מהתצלום כשהוא טרי, אחרת חי. הסינון והספירה בקוד. ---
  const view = DAY_VIEW_TOOLS[name];
  if (view) {
    const dayISO = resolveDayISO(input.day);
    const out = await buildDayView({
      dayISO,
      from: typeof input.from === "string" && input.from ? input.from : undefined,
      to: typeof input.to === "string" && input.to ? input.to : undefined,
      minSeats: name === "tabit_big_tables" ? Math.max(1, Number(input.min) || 8) : undefined,
      missingDepositOnly: name === "tabit_deposit_summary",
      title: view.title,
      summaryNoun: view.summaryNoun,
    });
    return {
      result: out,
      provenance: { toolLabel, scopeLabel: out.day_label, source: out.source, ageMinutes: out.data_age_minutes },
    };
  }

  // --- כלים שמחושבים כולם בצד השרת מעל אותם נתונים ---
  if (name === "tabit_find_reservation") {
    const out = (await serverFindReservation(input)) as { scope: string; source: string; data_age_minutes?: number };
    return {
      result: out,
      provenance: { toolLabel, scopeLabel: out.scope, source: out.source as Provenance["source"], ageMinutes: out.data_age_minutes ?? null },
    };
  }
  if (name === "tabit_table_schedule") {
    const out = (await serverTableSchedule(input)) as { scope: string; source: string; data_age_minutes?: number };
    return {
      result: out,
      provenance: { toolLabel, scopeLabel: out.scope, source: out.source as Provenance["source"], ageMinutes: out.data_age_minutes ?? null },
    };
  }

  // --- הפנקס שלנו קודם: הוא מגיע אחורה הרבה מעבר ל-24 השעות של טאביט ---
  if (LEDGER_READS && LEDGER_TOOLS.has(name) && (input.day || name === "tabit_day_outcome")) {
    const dayISO = resolveDayISO(input.day);
    if (dayISO <= todayIL()) {
      const hit = await fromLedger(name, dayISO);
      if (hit) {
        return {
          result: hit,
          provenance: { toolLabel, scopeLabel: dayLabelHe(dayISO), source: "ledger" },
        };
      }
    }
  }

  const action = TOOL_TO_ACTION[name];
  if (!action) throw new Error(`כלי לא מוכר: ${name}`);
  // חוסם פעולות כתיבה בשלב 1 (backstop - הכלי ממילא לא נחשף למודל)
  if (!WRITES_ENABLED && WRITE_TOOL_NAMES.has(name)) throw new Error("פעולות כתיבה מושבתות בשלב 1 (קריאה בלבד)");

  // --- שער שעות הפתיחה (דטרמיניסטי) ---
  // זמינות בשעה שהמסעדה סגורה לא מגיעה בכלל לטאביט: ביום סגור "הכל פנוי",
  // ולכן בלי השער הזה הבוט מאשר בביטחון שעה סגורה.
  if (name === "tabit_check_availability") {
    const date = String(input.date ?? "");
    const time = String(input.time ?? "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{1,2}:\d{2}$/.test(time)) {
      const cfg = await loadBusinessConfig();
      const gate = checkOpenAt(cfg, date, time);
      const prov: Provenance = { toolLabel, scopeLabel: `${dayLabelHe(date)} ${time}`, source: "live" };
      if (!gate.open) {
        return {
          result: {
            date, time, weekday_he: gate.weekday_he,
            closed_at_requested_time: true,
            hours_that_day: gate.hours_that_day ?? "סגור",
            message: gate.hours_that_day
              ? `המסעדה לא מקבלת סועדים ב-${time} ביום ${gate.weekday_he} (שעות הפעילות: ${gate.hours_that_day}, ישיבה עד שעה לפני הסגירה). אל תדווח זמינות - הצע שעה בתוך שעות הפעילות.`
              : `המסעדה סגורה ביום ${gate.weekday_he} ${date}. אל תדווח זמינות.`,
          },
          provenance: { ...prov, source: "none" },
        };
      }
      const out = await runCommand(action, input, 45_000);
      const merged = out && typeof out === "object"
        ? { weekday_he: gate.weekday_he, hours_that_day: gate.hours_that_day, ...(out as object) }
        : out;
      return { result: merged, provenance: prov };
    }
  }

  // --- שאר הכלים: סבב אל הסוכן המקומי ---
  // הסוכן סוקר עד כל 15 שניות במצב שקט, לכן הפקודה הראשונה עשויה לחכות רגע
  // להיתפס. יצירה מקבלת timeout ארוך יותר (יצירה + שליפת הקישור).
  const timeout = action === "create_reservation" ? 70_000 : 45_000;
  const dayISO = dayArgOf(input);
  // מטמון רק לכלי קריאה על ימים שכבר קרו. כתיבה ומצב-חי לעולם לא.
  const cacheable = !WRITE_TOOL_NAMES.has(name) && name !== "tabit_tables_status" && name !== "tabit_health";
  const out = cacheable && dayISO
    ? await cachedAgentCall(action, input, dayISO, timeout)
    : await runCommand(action, input, timeout);

  const o = (out ?? {}) as Record<string, unknown>;
  const scopeLabel =
    typeof o.window_from === "string" && typeof o.window_to === "string"
      ? `${o.window_from} עד ${o.window_to}`
      : dayISO
        ? dayLabelHe(dayISO)
        : name === "tabit_tables_status"
          ? "עכשיו"
          : "";
  const enriched =
    dayISO && typeof out === "object" && out
      ? { weekday_he: weekdayHe(dayISO), day_label: dayLabelHe(dayISO), ...o }
      : out;
  return {
    result: enriched,
    provenance: {
      toolLabel,
      scopeLabel,
      source: o.source === "archive" ? "archive" : o.not_yet ? "none" : "live",
    },
  };
}

export interface TabitChatMessage {
  role: "user" | "assistant";
  content: string;
}
export interface TabitToolLogEntry {
  tool: string;
  params: unknown;
  ok: boolean;
  result?: unknown;
  error?: string;
  /** תיאור בעברית של מה נבדק, להצגה בממשק */
  summary?: string;
  /** כמה זמן לקחה הקריאה, לאבחון איטיות */
  ms?: number;
}
export interface TabitChatResult {
  reply: string;
  toolLog: TabitToolLogEntry[];
}

/**
 * מריץ סבב שיחה מול טאביט ומחזיר תשובה + לוג כלים.
 * forceReadOnly: כופה חשיפת כלי-קריאה בלבד (בוט הקבוצה תמיד כזה).
 * extraSystem: הנחיית מערכת נוספת (למשל פורמט קבוצת וואטסאפ).
 * withSourceFooter: האם להוסיף את שורת המקור (ברירת מחדל כן).
 * זורק אם חסר ANTHROPIC_API_KEY - הקורא מטפל.
 */
export async function runTabitChat(
  history: TabitChatMessage[],
  opts?: {
    forceReadOnly?: boolean;
    extraSystem?: string;
    withSourceFooter?: boolean;
    /**
     * החלפת שכבת הכלים. קיים בשביל סוללת ההערכה (scripts/lab-eval.mjs):
     * נתוני דמה קבועים במקום טאביט אמיתי, כדי שאפשר יהיה לבדוק את התנהגות
     * המודל מול מספרים ידועים, בלי רשת, בלי הסוכן, ובאותה תוצאה בכל הרצה.
     */
    toolRunner?: (name: string, input: Record<string, unknown>) => Promise<DispatchOutcome>;
    /**
     * שעון מוזרק, לבדיקות בלבד. בלעדיו סוללת ההערכה נכשלת כשמריצים אותה בין
     * חצות לחמש (שער העמימות נכנס ומחזיר שאלת הבהרה במקום תשובה) - כלומר
     * בדיוק בשעות שבהן עובדים עליה.
     */
    nowMs?: number;
  }
): Promise<TabitChatResult> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("missing ANTHROPIC_API_KEY");

  const lastUser = [...history].reverse().find((m) => m.role === "user")?.content ?? "";

  // ----- פענוח היום, בקוד, לפני שהמודל רואה משהו -----
  // כשמילת זמן באמת עמומה (אחרי חצות) עונים את שאלת ההבהרה **כמו שהיא** ולא
  // מריצים את המודל בכלל: זה בדיוק המקום שבו הוא סילף את שני התאריכים.
  const shiftedMentions = history.filter(
    (m) => m.role === "user" && !hasExplicitDateLite(m.content) && hasShiftedWord(m.content)
  ).length;
  const dayCtx = labDayContext(lastUser, opts?.nowMs ?? Date.now(), shiftedMentions >= 2);
  if (dayCtx.question) return { reply: dayCtx.question, toolLog: [] };

  const effectiveWrites = WRITES_ENABLED && !opts?.forceReadOnly;
  const tools = effectiveWrites ? TOOLS : READ_TOOLS;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 90_000 });
  const msgs: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));
  const toolLog: TabitToolLogEntry[] = [];
  const provenance: Provenance[] = [];

  // לוח התאריכים ושעות הפתיחה - מחושבים בקוד ומוזרקים לכל שיחה.
  // אם הקונפיג לא נטען מסיבה כלשהי, ממשיכים בלי בלוק השעות.
  let hoursText = "";
  try {
    hoursText = hoursBlock(await loadBusinessConfig());
  } catch { /* בלי שעות - הכללים עדיין תקפים */ }

  // הפרומפט+כלים הסטטיים במטמון (ttl 1h); הבלוק הדינמי נפרד כדי לא לפספס מטמון.
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: LAB_SYSTEM + (effectiveWrites ? `\n\n${LAB_WRITE_RULES}` : ""), cache_control: { type: "ephemeral", ttl: "1h" } },
    { type: "text", text: [`השעה בישראל כעת: ${israelNow()}.`, calendarBlock(), hoursText].filter(Boolean).join("\n\n") },
  ];
  if (dayCtx.line) system.push({ type: "text", text: dayCtx.line });
  if (!effectiveWrites) system.push({ type: "text", text: LAB_READ_ONLY_NOTE });
  if (opts?.extraSystem) system.push({ type: "text", text: opts.extraSystem });

  for (let i = 0; i < MAX_TOOL_ROUNDS; i++) {
    const resp = await anthropic.messages.create({ model: MODEL, max_tokens: 3000, system, tools, messages: msgs });
    await recordLlmUsage(MODEL, resp.usage, false, "tabit-lab");
    const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    msgs.push({ role: "assistant", content: resp.content });

    if (!toolUses.length) {
      const text = resp.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text).join("\n").trim();
      const reply = text || "(אין תשובה)";
      const footer = opts?.withSourceFooter === false ? "" : buildSourceFooter(provenance);
      return { reply: footer ? `${reply}\n\n${footer}` : reply, toolLog };
    }

    // הרצה במקביל: שתי בדיקות באותו סבב לא צריכות לחכות זו לזו.
    const results = await Promise.all(
      toolUses.map(async (tu) => {
        const started = Date.now();
        const run = opts?.toolRunner ?? dispatch;
        try {
          const { result, provenance: prov } = await run(tu.name, (tu.input as Record<string, unknown>) || {});
          provenance.push(prov);
          return { tu, ok: true as const, out: result, prov, ms: Date.now() - started };
        } catch (e) {
          return { tu, ok: false as const, out: { error: e instanceof Error ? e.message : "שגיאה" }, prov: null, ms: Date.now() - started };
        }
      })
    );

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const r of results) {
      toolLog.push({
        tool: r.tu.name,
        params: r.tu.input,
        ok: r.ok,
        result: r.ok ? r.out : undefined,
        error: r.ok ? undefined : (r.out as { error: string }).error,
        summary: r.prov ? `${r.prov.toolLabel}${r.prov.scopeLabel ? ` · ${r.prov.scopeLabel}` : ""}` : TOOL_LABEL_HE[r.tu.name] ?? r.tu.name,
        ms: r.ms,
      });
      toolResults.push({
        type: "tool_result",
        tool_use_id: r.tu.id,
        content: JSON.stringify(r.out).slice(0, 40000),
        is_error: !r.ok,
      });
    }
    msgs.push({ role: "user", content: toolResults });
  }

  return { reply: "(עצרתי אחרי כמה סבבי כלים - נסה שוב או פשט את הבקשה)", toolLog };
}

// שתי בדיקות קלות שמשמשות רק לספירת "כמה פעמים כבר שאלנו" בחלון החצות.
// מכוונות בכוונה לצד הסלחני: טעות כאן שווה שאלת הבהרה מיותרת, לא תשובה שגויה.
function hasExplicitDateLite(text: string): boolean {
  return /(^|[^\d:])\d{1,2}[./-]\d{1,2}(?![\d:])/.test(text);
}
function hasShiftedWord(text: string): boolean {
  return /(^|[^֐-׿])[לבהוכשמ]?(מחרתיים|מחר|אתמול|שלשום)(?![֐-׿])/.test(text);
}

