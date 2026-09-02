import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { isMasterAuthorized } from "@/lib/admin-auth";
import { runCommand, type TabitAction } from "@/lib/tabit-queue";

/**
 * צ'אט בדיקות מבודד לטאביט - למנהל הראשי בלבד.
 *
 * מבודד לחלוטין מהצ'אטבוט הציבורי: system prompt נפרד, אין קשר לערוצים,
 * לא נשמר בשיחות ה-DB, לא משתמש ב-business config. הכלים ניגשים לטאביט דרך
 * תור הפקודות (הסוכן המקומי מבצע). כלי היצירה הוא הוספה בלבד - אין שום כלי
 * לשינוי/ביטול/מחיקה של הזמנות קיימות.
 */

export const runtime = "nodejs";
export const maxDuration = 200;

const MODEL = process.env.CHATBOT_MODEL ?? "claude-sonnet-4-6";

function israelNow(): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem", weekday: "long", year: "numeric", month: "long",
    day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date());
}

const TOOLS: Anthropic.Tool[] = [
  { name: "tabit_health", description: "בדוק את החיבור לטאביט: טוען נתונים ומחזיר כמה הזמנות נטענו וגרסת שרת. השתמש כשמבקשים לוודא שהחיבור עובד.", input_schema: { type: "object", properties: {} } },
  { name: "tabit_read_day", description: "קרא את ההזמנות של יום מסוים מטאביט. day = \"today\" | \"tomorrow\" | \"YYYY-MM-DD\".", input_schema: { type: "object", properties: { day: { type: "string" } }, required: ["day"] } },
  { name: "tabit_deposit_summary", description: "סיכום פיקדונות ליום: כמה מובטחים וכמה חסרים, ורשימת החסרים. day כמו ב-read_day.", input_schema: { type: "object", properties: { day: { type: "string" } }, required: ["day"] } },
  { name: "tabit_get_deposit_link", description: "שלוף את קישור הפיקדון של הזמנה לפי reservationId.", input_schema: { type: "object", properties: { reservationId: { type: "string" } }, required: ["reservationId"] } },
  { name: "tabit_create_reservation", description: "צור הזמנה חדשה בטאביט. הוספה בלבד - לעולם לא נוגע בהזמנות קיימות. seating: \"inside\"=בפנים, \"outside\"=בחוץ (המערכת בוחרת אוטומטית ובאקראי בין 'כניסה ראשית' ל'מול המסך'). שיוך השולחן אוטומטי וחכם (לפי מספר הסועדים, האזור, ומה שפנוי באותה שעה, כולל צירוף שולחנות). send_deposit_link=true שולח ללקוח SMS עם קישור הפיקדון; false רק מחזיר את הקישור. מחזיר מזהה, אזור, שולחנות וקישור פיקדון.", input_schema: { type: "object", properties: { name: { type: "string" }, phone: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD" }, time: { type: "string", description: "HH:MM" }, seats: { type: "number" }, seating: { type: "string", enum: ["inside", "outside"], description: "בפנים או בחוץ" }, send_deposit_link: { type: "boolean", description: "האם לשלוח ללקוח SMS עם קישור הפיקדון" } }, required: ["name", "phone", "date", "time", "seats", "seating", "send_deposit_link"] } },
  { name: "tabit_check_availability", description: "בדוק אם יש מקום פנוי לקבוצה בשעה ותאריך נתונים. seating (inside/outside) מגביל לאזור המבוקש - **חובה להעביר אותו אם הלקוח ציין פנים/חוץ**, אחרת הבדיקה עלולה להחזיר שולחן מהאזור הלא נכון. מחזיר האם פנוי, איזה שולחן, ובאיזה אזור. לא יוצר כלום.", input_schema: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD" }, time: { type: "string", description: "HH:MM" }, seats: { type: "number" }, seating: { type: "string", enum: ["inside", "outside"] } }, required: ["date", "time", "seats"] } },
  { name: "tabit_customer_lookup", description: "חפש לקוח לפי טלפון או שם, והחזר את ההזמנות הקרובות שלו, מספר ביקורים בעבר, אי-הגעות וביטולים. קריאה בלבד.", input_schema: { type: "object", properties: { phone: { type: "string" }, name: { type: "string" } } } },
  { name: "tabit_tables_status", description: "מצב השולחנות החי כרגע: כמה פנויים, תפוסים, מלוכלכים, וסה\"כ מקומות.", input_schema: { type: "object", properties: {} } },
  { name: "tabit_no_show_summary", description: "מעקב אי-הגעה וביטולים מתוך הארכיון ב-N הימים האחרונים (ברירת מחדל 30): כמה no-show, כמה ביטולים, אחוז אי-הגעה, ולקוחות שלא הגיעו יותר מפעם אחת.", input_schema: { type: "object", properties: { days: { type: "number" } } } },
  { name: "tabit_booking_sources", description: "פילוח מקורות ההזמנות ב-N הימים האחרונים (ברירת מחדל 30): אונליין, גוגל, טלפון/צוות, הגעה מהרחוב.", input_schema: { type: "object", properties: { days: { type: "number" } } } },
  { name: "tabit_modify_reservation", description: "שנה הזמנה קיימת (כתיבה!). reservation_id הוא מזהה ההזמנה (משיג אותו קודם דרך read_day/customer_lookup). שלח רק את השדות שמשתנים: seating (inside/outside), date (YYYY-MM-DD), time (HH:MM), seats. השולחנות משויכים מחדש אוטומטית. אסור לקרוא לכלי הזה לפני שהצגת למשתמש את ההזמנה המדויקת וקיבלת אישור 'כן' מפורש.", input_schema: { type: "object", properties: { reservation_id: { type: "string" }, seating: { type: "string", enum: ["inside", "outside"] }, date: { type: "string" }, time: { type: "string" }, seats: { type: "number" } }, required: ["reservation_id"] } },
  { name: "tabit_cancel_reservation", description: "בטל הזמנה קיימת (כתיבה!). reservation_id הוא מזהה ההזמנה. אסור לקרוא לכלי הזה לפני שהצגת למשתמש את ההזמנה המדויקת וקיבלת אישור 'כן' מפורש לביטול.", input_schema: { type: "object", properties: { reservation_id: { type: "string" } }, required: ["reservation_id"] } },
];

const TOOL_TO_ACTION: Record<string, TabitAction> = {
  tabit_health: "health",
  tabit_read_day: "read_day",
  tabit_deposit_summary: "deposit_summary",
  tabit_get_deposit_link: "get_deposit_link",
  tabit_create_reservation: "create_reservation",
  tabit_check_availability: "check_availability",
  tabit_customer_lookup: "customer_lookup",
  tabit_tables_status: "tables_status",
  tabit_no_show_summary: "no_show_summary",
  tabit_booking_sources: "booking_sources",
  tabit_modify_reservation: "modify_reservation",
  tabit_cancel_reservation: "cancel_reservation",
};

const SYSTEM = `אתה עוזר בדיקות פנימי של החיבור למערכת ההזמנות טאביט, עבור מסעדת "קפה קוואלי".

זו סביבה מבודדת לגמרי: אף לקוח לא רואה את השיחה הזאת, והיא לא קשורה לצ'אטבוט הציבורי שבערוצים. המטרה: לעזור למנהל לבדוק מה עובד ומה לא מול טאביט.

הכלים שלך:
- tabit_health: בדיקת חיבור.
- tabit_read_day / tabit_deposit_summary: קריאת הזמנות וסטטוס פיקדונות ליום.
- tabit_get_deposit_link: קישור פיקדון להזמנה.
- tabit_create_reservation: יצירת הזמנה חדשה (הוספה בלבד).
- tabit_check_availability: בדיקת זמינות מקום לקבוצה בתאריך ושעה.
- tabit_customer_lookup: חיפוש לקוח (טלפון/שם) - הזמנות קרובות, ביקורים, אי-הגעות.
- tabit_tables_status: מצב השולחנות החי (פנוי/תפוס/מלוכלך).
- tabit_no_show_summary: מעקב אי-הגעה וביטולים מהארכיון.
- tabit_booking_sources: פילוח מקורות ההזמנות (אונליין/גוגל/טלפון/הגעה).
- tabit_modify_reservation / tabit_cancel_reservation: שינוי או ביטול הזמנה קיימת - כתיבה! רק אחרי זיהוי מדויק ואישור מפורש (ראה כלל 1).

כללים קשיחים:
1. **שינוי וביטול הזמנות קיימות** (tabit_modify_reservation / tabit_cancel_reservation) הם כלים חזקים ומסוכנים, ולכן חוקים נוקשים שאסור לעבור עליהם:
   א. לעולם אל תשנה או תבטל בלי לזהות קודם את **ההזמנה המדויקת**. השתמש ב-tabit_read_day או tabit_customer_lookup כדי למצוא אותה ולקבל את ה-reservation_id.
   ב. אם יותר מהזמנה אחת מתאימה, או שלא ברור לחלוטין על איזו מדובר - **שאל, אל תנחש**. אף פעם אל תפעל על סמך ניחוש.
   ג. **תמיד** הצג למשתמש את ההזמנה המלאה (שם, יום, שעה, מספר סועדים, אזור/שולחן נוכחי) ובקש אישור **"כן" מפורש** לפני שאתה קורא לכלי השינוי/ביטול. בלי "כן" ברור - אתה לא מבצע כלום.
   ד. אחרי הביצוע - דווח בדיוק **מה השתנה (לפני / אחרי)**. **חובה:** הכלי מחזיר שדה verified_changed (אימות מול טאביט). אם הוא false - השינוי **לא בוצע בפועל** (למשל אין מקום באזור), אז אמור זאת בבירור ואל תדווח הצלחה. אל תסמוך על ההנחה שלך, סמוך על האימות.
   ה. אין לך כלי אחר שנוגע בהזמנות קיימות מעבר לשניים האלה.
2. יצירת הזמנה - אסוף את הפרטים: שם, טלפון, מספר סועדים, תאריך, שעה, **בפנים או בחוץ** (seating: inside/outside; אם אומרים "בר" - אמור שזה לא נתמך כרגע ובקש פנים/חוץ), ו**האם לשלוח ללקוח קישור פיקדון** (send_deposit_link). הצג סיכום קצר של כל אלה, וצור רק אחרי אישור מפורש. אל תשאל על שולחן ספציפי - השיוך אוטומטי וחכם לפי האזור.
3. כשכלי נכשל - דווח בבירור מה נכשל ומה השגיאה. זו כל המטרה של סביבת הבדיקה.
4. ענה תמציתי וברור, בעברית.
5. שלמות הנתונים מעל הכל - אתה כלי בדיקה, לא תקציר שיווקי. כשמציגים רשימה, הצג את **כולה** ואל תקצר בשקט. "הזמנות גדולות" בלי מספר מפורש = 8+ סועדים כברירת מחדל; רשום את כל ההזמנות שעומדות בסף, ואם יש הרבה - אמור כמה יש ואל תשמיט.
6. פיקדון הוא מידע קריטי: בכל רשימת הזמנות, סמן במפורש אילו **חסרות פיקדון**, ואם יש ולו אחת חסרה - אמור זאת בבירור בסיכום (אל תיתן רושם שהכל מכוסה כשלא).
7. **לעולם אל תחשב או תסכם מספרים בעצמך** (סה"כ סועדים, כמה מובטחים וכו') - זה מקור לטעויות. השתמש אך ורק בשדות המחושבים שהכלי מחזיר: count (מספר הזמנות), covers (סה"כ סועדים), secured, missing. אם צריך סה"כ סועדים - קרא ל-tabit_read_day או tabit_deposit_summary וקח את covers משם כמו שהוא.

השעה בישראל כעת: ${israelNow()}.`;

async function dispatch(name: string, input: Record<string, unknown>): Promise<unknown> {
  const action = TOOL_TO_ACTION[name];
  if (!action) throw new Error(`כלי לא מוכר: ${name}`);
  // יצירת הזמנה מקבלת timeout ארוך יותר (יצירה + שליפת הקישור לוקחת רגע)
  const timeout = action === "create_reservation" ? 45_000 : 25_000;
  return runCommand(action, input, timeout);
}

export async function POST(req: NextRequest) {
  if (!isMasterAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "missing ANTHROPIC_API_KEY" }, { status: 503 });

  let body: { messages?: { role: "user" | "assistant"; content: string }[] } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const history = Array.isArray(body.messages) ? body.messages : [];
  if (!history.length) return NextResponse.json({ error: "no messages" }, { status: 400 });

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 60_000 });
  const msgs: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));
  const toolLog: { tool: string; params: unknown; ok: boolean; result?: unknown; error?: string }[] = [];

  for (let i = 0; i < 5; i++) {
    const resp = await anthropic.messages.create({ model: MODEL, max_tokens: 1500, system: SYSTEM, tools: TOOLS, messages: msgs });
    const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    msgs.push({ role: "assistant", content: resp.content });

    if (!toolUses.length) {
      const text = resp.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text).join("\n").trim();
      return NextResponse.json({ reply: text || "(אין תשובה)", toolLog });
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      let ok = true;
      let out: unknown;
      try {
        out = await dispatch(tu.name, (tu.input as Record<string, unknown>) || {});
      } catch (e) {
        ok = false;
        out = { error: e instanceof Error ? e.message : "שגיאה" };
      }
      toolLog.push({ tool: tu.name, params: tu.input, ok, result: ok ? out : undefined, error: ok ? undefined : (out as { error: string }).error });
      toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out).slice(0, 6000), is_error: !ok });
    }
    msgs.push({ role: "user", content: toolResults });
  }

  return NextResponse.json({ reply: "(עצרתי אחרי כמה סבבי כלים - נסה שוב או פשט את הבקשה)", toolLog });
}
