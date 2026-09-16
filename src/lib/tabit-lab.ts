import Anthropic from "@anthropic-ai/sdk";
import { runCommand, type TabitAction } from "./tabit-queue";
import { recordLlmUsage } from "./usage";
import { loadBusinessConfig } from "./business-config-store";
import {
  calendarBlock, hoursBlock, checkOpenAt, resolveDayISO, weekdayHe, todayIL,
  loadSnapshot, snapshotAgeMinutes, filterRows, rowOut, type LabResRow,
} from "./tabit-lab-smart";

/**
 * לולאת השיחה מול טאביט - משותפת לשני משטחי הגישה: מעבדת הצ'אט בפאנל
 * (testchat) ובוט הקבוצה בוואטסאפ (Green API). מבודדת לגמרי מהצ'אטבוט הציבורי.
 *
 * שלב 1: פעולות כתיבה (יצירה/שינוי/ביטול) מושבתות. נחשפות למודל רק אם
 * TABIT_WRITES_ENABLED="true", ובוט הקבוצה כופה קריאה-בלבד תמיד (forceReadOnly).
 * הגנת עומק: dispatch חוסם, והסוכן המקומי (agent.js) חוסם שוב מול טאביט.
 */

// מודל ייעודי לטאביט, נפרד מהבוט הציבורי. ברירת מחדל Haiku - סביבה פנימית, זול.
const MODEL = process.env.TABIT_LAB_MODEL ?? "claude-haiku-4-5-20251001";

function israelNow(): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem", weekday: "long", year: "numeric", month: "long",
    day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date());
}

const TOOLS: Anthropic.Tool[] = [
  { name: "tabit_health", description: "בדוק את החיבור לטאביט: טוען נתונים ומחזיר כמה הזמנות נטענו וגרסת שרת. השתמש כשמבקשים לוודא שהחיבור עובד.", input_schema: { type: "object", properties: {} } },
  { name: "tabit_read_day", description: "קרא את ההזמנות של יום מסוים מטאביט. day = \"today\" | \"tomorrow\" | \"yesterday\" | \"YYYY-MM-DD\". ימי עבר נקראים מהארכיון אוטומטית.", input_schema: { type: "object", properties: { day: { type: "string" } }, required: ["day"] } },
  { name: "tabit_big_tables", description: "שולחנות גדולים ליום - הרשימה **מסוננת, ממוינת וספורה בקוד** (לא על ידך). ברירת מחדל 8+ סועדים (אפשר min אחר). מחזיר count, covers, missing_deposit והרשימה עצמה - מוכנים. זה הכלי הנכון לכל שאלה על 'שולחנות/הזמנות גדולות'. אל תסנן/תספור בעצמך, קח את מה שחוזר. day כמו ב-read_day.", input_schema: { type: "object", properties: { day: { type: "string" }, min: { type: "number" } }, required: ["day"] } },
  { name: "tabit_covers_summary", description: "כמה אנשים (סה\"כ סועדים) וכמה הזמנות יש ביום, אופציונלית בטווח שעות. from/to בפורמט HH:MM (ערב = from \"18:00\"; צהריים = to \"18:00\"). מחזיר count ו-covers מחושבים בקוד - קח אותם כמו שהם, אל תסכם בעצמך. השתמש בזה לכל שאלת 'כמה אנשים/מוזמנים' (בשעה/בערב/בטווח).", input_schema: { type: "object", properties: { day: { type: "string" }, from: { type: "string" }, to: { type: "string" } }, required: ["day"] } },
  { name: "tabit_deposit_summary", description: "סיכום פיקדונות ליום: כמה מובטחים וכמה חסרים, ורשימת החסרים. day כמו ב-read_day.", input_schema: { type: "object", properties: { day: { type: "string" } }, required: ["day"] } },
  { name: "tabit_get_deposit_link", description: "שלוף את קישור הפיקדון של הזמנה לפי reservationId.", input_schema: { type: "object", properties: { reservationId: { type: "string" } }, required: ["reservationId"] } },
  { name: "tabit_create_reservation", description: "צור הזמנה חדשה בטאביט. הוספה בלבד - לעולם לא נוגע בהזמנות קיימות. seating: \"inside\"=בפנים, \"outside\"=בחוץ (המערכת בוחרת אוטומטית ובאקראי בין 'כניסה ראשית' ל'מול המסך'). שיוך השולחן אוטומטי וחכם (לפי מספר הסועדים, האזור, ומה שפנוי באותה שעה, כולל צירוף שולחנות). send_deposit_link=true שולח ללקוח SMS עם קישור הפיקדון; false רק מחזיר את הקישור. מחזיר מזהה, אזור, שולחנות וקישור פיקדון.", input_schema: { type: "object", properties: { name: { type: "string" }, phone: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD" }, time: { type: "string", description: "HH:MM" }, seats: { type: "number" }, seating: { type: "string", enum: ["inside", "outside"], description: "בפנים או בחוץ" }, send_deposit_link: { type: "boolean", description: "האם לשלוח ללקוח SMS עם קישור הפיקדון" } }, required: ["name", "phone", "date", "time", "seats", "seating", "send_deposit_link"] } },
  { name: "tabit_check_availability", description: "בדוק אם יש מקום פנוי לקבוצה בשעה ותאריך נתונים. seating (inside/outside) מגביל לאזור המבוקש - **חובה להעביר אותו אם הלקוח ציין פנים/חוץ**, אחרת הבדיקה עלולה להחזיר שולחן מהאזור הלא נכון. מחזיר האם פנוי, איזה שולחן, ובאיזה אזור. לא יוצר כלום.", input_schema: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD" }, time: { type: "string", description: "HH:MM" }, seats: { type: "number" }, seating: { type: "string", enum: ["inside", "outside"] } }, required: ["date", "time", "seats"] } },
  { name: "tabit_customer_lookup", description: "פרופיל לקוח: ביקורים בעבר, אי-הגעות וביטולים (מהארכיון) + הזמנות קרובות. השתמש בו לשאלות על *הלקוח* (\"הוא מגיע הרבה?\"). כדי *למצוא הזמנה* - השתמש ב-tabit_find_reservation.", input_schema: { type: "object", properties: { phone: { type: "string" }, name: { type: "string" } } } },
  { name: "tabit_find_reservation", description: "מציאת הזמנה לפי שם ו/או טלפון (אפשר חלקי). החיפוש גמיש (רישיות/רווחים/קידומות) ומבוצע בקוד. אם צוין day ולא נמצא באותו יום - מחפש אוטומטית בכל הימים הקרובים ומחזיר איפה כן נמצא (שדה found_on_other_days). **זה הכלי לכל 'תמצא לי את ההזמנה של X'** - אל תסרוק read_day בעצמך. day = today/tomorrow/YYYY-MM-DD (אופציונלי; יום עבר נתמך).", input_schema: { type: "object", properties: { name: { type: "string" }, phone: { type: "string" }, day: { type: "string" } } } },
  { name: "tabit_table_schedule", description: "כל ההזמנות המשויכות לשולחן/שולחנות מסוימים (למשל [69,70]), ליום נתון או לכל הימים הקרובים. הסינון מבוצע בקוד. **זה הכלי היחיד לשאלות 'מה יש על שולחן X' / 'יש הזמנות על שולחן X?'** - לעולם אל תענה על שולחן ספציפי מסריקה ידנית של רשימות. מחזיר גם מי יושב עכשיו על השולחן (אם היום).", input_schema: { type: "object", properties: { tables: { type: "array", items: { type: "number" } }, day: { type: "string" } }, required: ["tables"] } },
  { name: "tabit_tables_status", description: "מצב השולחנות החי כרגע: כמה פנויים, תפוסים, מלוכלכים, וסה\"כ מקומות.", input_schema: { type: "object", properties: {} } },
  { name: "tabit_no_show_summary", description: "מעקב אי-הגעה וביטולים מתוך הארכיון ב-N הימים האחרונים (ברירת מחדל 30): כמה no-show, כמה ביטולים, אחוז אי-הגעה, ולקוחות שלא הגיעו יותר מפעם אחת.", input_schema: { type: "object", properties: { days: { type: "number" } } } },
  { name: "tabit_booking_sources", description: "פילוח מקורות ההזמנות ב-N הימים האחרונים (ברירת מחדל 30): אונליין, גוגל, טלפון/צוות, הגעה מהרחוב.", input_schema: { type: "object", properties: { days: { type: "number" } } } },
  { name: "tabit_modify_reservation", description: "שנה הזמנה קיימת (כתיבה!). reservation_id הוא מזהה ההזמנה (משיג אותו קודם דרך read_day/customer_lookup). שלח רק את השדות שמשתנים: seating (inside/outside), date (YYYY-MM-DD), time (HH:MM), seats. השולחנות משויכים מחדש אוטומטית. אסור לקרוא לכלי הזה לפני שהצגת למשתמש את ההזמנה המדויקת וקיבלת אישור 'כן' מפורש.", input_schema: { type: "object", properties: { reservation_id: { type: "string" }, seating: { type: "string", enum: ["inside", "outside"] }, date: { type: "string" }, time: { type: "string" }, seats: { type: "number" } }, required: ["reservation_id"] } },
  { name: "tabit_cancel_reservation", description: "בטל הזמנה קיימת (כתיבה!). reservation_id הוא מזהה ההזמנה. אסור לקרוא לכלי הזה לפני שהצגת למשתמש את ההזמנה המדויקת וקיבלת אישור 'כן' מפורש לביטול.", input_schema: { type: "object", properties: { reservation_id: { type: "string" } }, required: ["reservation_id"] } },
];

const WRITE_TOOL_NAMES = new Set(["tabit_create_reservation", "tabit_modify_reservation", "tabit_cancel_reservation"]);
const WRITES_ENABLED = process.env.TABIT_WRITES_ENABLED === "true";
const READ_TOOLS: Anthropic.Tool[] = TOOLS.filter((t) => !WRITE_TOOL_NAMES.has(t.name));

const TOOL_TO_ACTION: Record<string, TabitAction> = {
  tabit_health: "health",
  tabit_read_day: "read_day",
  tabit_big_tables: "big_tables",
  tabit_covers_summary: "covers_summary",
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

const SYSTEM = `אתה עוזר פנימי של החיבור למערכת ההזמנות טאביט, עבור מסעדת "קפה קוואלי".

זו סביבה מבודדת לגמרי מהצ'אטבוט הציבורי שבערוצים: אף לקוח לא רואה את זה. המטרה: לתת לצוות מידע מדויק מטאביט.

הכלים שלך:
- tabit_health: בדיקת חיבור.
- tabit_read_day / tabit_deposit_summary: קריאת הזמנות וסטטוס פיקדונות ליום.
- tabit_big_tables: שולחנות גדולים ליום (8+ כברירת מחדל) - מסונן וספור בקוד. הכלי לכל שאלה על הזמנות גדולות.
- tabit_covers_summary: כמה אנשים/הזמנות ביום או בטווח שעות (ערב=from 18:00) - מספרים מחושבים מוכנים.
- tabit_get_deposit_link: קישור פיקדון להזמנה.
- tabit_create_reservation: יצירת הזמנה חדשה (הוספה בלבד).
- tabit_check_availability: בדיקת זמינות מקום לקבוצה בתאריך ושעה.
- tabit_find_reservation: **מציאת הזמנה** לפי שם/טלפון (חיפוש גמיש בקוד; מחפש גם בימים אחרים אם לא נמצא ביום שצוין).
- tabit_table_schedule: **כל ההזמנות של שולחן/שולחנות מסוימים** + מי יושב שם עכשיו.
- tabit_customer_lookup: פרופיל לקוח (ביקורים בעבר, אי-הגעות) - לא לחיפוש הזמנות.
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
3. כשכלי נכשל - דווח בבירור מה נכשל ומה השגיאה.
4. ענה תמציתי וברור, בעברית.
5. שלמות הנתונים מעל הכל - אתה כלי מידע, לא תקציר שיווקי. כשמציגים רשימה, הצג את **כולה** ואל תקצר בשקט. "הזמנות גדולות" בלי מספר מפורש = 8+ סועדים כברירת מחדל. **לשאלות על שולחנות/הזמנות גדולות קרא ל-tabit_big_tables** (הוא מסנן, ממיין וסופר בקוד) - אל תסנן את tabit_read_day בעצמך. רשום את כל מה שהכלי החזיר, ואם יש הרבה - אמור כמה יש ואל תשמיט.
6. פיקדון הוא מידע קריטי: בכל רשימת הזמנות, סמן במפורש אילו **חסרות פיקדון**, ואם יש ולו אחת חסרה - אמור זאת בבירור בסיכום (אל תיתן רושם שהכל מכוסה כשלא).
7. **לעולם אל תחשב או תסכם מספרים בעצמך** (סה"כ סועדים, כמה מובטחים וכו') - זה מקור לטעויות. השתמש אך ורק בשדות המחושבים שהכלי מחזיר: count, covers, secured, missing. לשאלת "כמה אנשים/מוזמנים" בשעה/בערב/בטווח - קרא ל-**tabit_covers_summary** עם from/to (ערב = from "18:00", צהריים = to "18:00") וקח את covers כמו שהוא. אל תסכם ידנית רשימת הזמנות אף פעם.
8. **ענה ישיר וקצר.** כשמבקשים מספר - **המשפט הראשון הוא המספר** (למשל: "היום מ-18:00 יש 84 סועדים ב-19 הזמנות"). בלי הקדמות ארוכות, בלי לתאר את התהליך שעשית, בלי תשובות מסובכות. פרט נוסף רק אם ביקשו או אם באמת עוזר.
9. **פורמט:** התשובות מיועדות לוואטסאפ. אל תשתמש לעולם במקפים ארוכים (—) ולא בחצים (←, →) - הם נשברים בוואטסאפ; במקומם השתמש בפסיק, נקודה מפרידה (·), או ניסוח רגיל. הדגשה ב-**כוכביות**. מותר וטוב להשתמש בטבלת markdown לרשימות (הפאנל מרנדר אותה יפה, וכפתור ההעתקה ממיר אותה אוטומטית לפורמט וואטסאפ נקי). כשאתה מציג רשימת הזמנות כטבלה, סדר העמודות **תמיד**: שם, שעה, סועדים, שולחנות, **טלפון**, פיקדון - כלול תמיד את הטלפון (שדה phone) בעמודה שלפני הפיקדון. לתשובה שהיא מספר או סטטוס בודד (כמה סועדים, זמינות, הכנסה, בריאות) - שורה אחת, בלי טבלה.
10. **המשכיות שיחה:** השתמש תמיד בהקשר של השיחה. אם מתייחסים לפריט מתשובה קודמת ("של זה בלי הפיקדון", "הטלפון שלו", "אותה הזמנה") - זהה למי הכוונה מהתשובה הקודמת. אם הפרט כבר מופיע (למשל טלפון בטבלה) קח אותו משם; אם לא, קרא שוב לכלי המתאים לאותו יום/הקשר ושלוף. תשובת המשך = קצרה, רק מה שנשאל, בלי לחזור על כל הרשימה.
11. **לעולם אל תגיד "אני לא יכול" או "אני לא יודע".** בתחום טאביט תמיד תענה, תשלוף שוב, או תשאל שאלת הבהרה קצרה. רק אם משהו באמת מחוץ ליכולת (פעולת כתיבה על הזמנה, או מידע שטאביט לא מחזיק) - אמור בקצרה מה כן אפשר.
12. **אי-בהירות → שאלה ממוקדת, לא ניחוש:** אם לא ברור על איזו הזמנה/יום מדובר, שאל שאלה אחת שמציגה את האפשרויות (למשל "יש שתיים בלי פיקדון היום, מיטל 20:30 ודני 21:00 - על מי?"). אם לא צוין יום - הנח היום ואמור זאת. **חריג חשוב - חיפוש הזמנה/שולחן (כלל 21): שם, טלפון או מספר שולחן הם קלט מספיק לחיפוש. אסור לשאול "איזה יום?" או לבקש עוד פרטים לפני שהכלי רץ - קודם מחפשים בכל הימים, ורק על סמך התוצאות שואלים אם צריך.**
13. **מחוץ לתחום:** שאלה לא קשורה לטאביט - הכוון בעדינות למה שאתה כן עושה (הזמנות, פיקדונות, זמינות, מצב שולחנות, אי-הגעות, מקורות, הכנסות).
14. **גדול מול קטן:** big_tables לשולחנות גדולים. אם שואלים על קטנים / כל השאר - קרא read_day והצג אותם (מותר להציג תת-קבוצה כשמבקשים במפורש). אל תגיד שאתה עונה רק על גדולים.
15. **זמינות (check_availability):** אתה מדווח זמינות, לא שומר/משייך מקום (שמירה תיפתח בשלב 2). הצג את **כל** השולחנות הפנויים במשבצת (השדה free_tables), לא רק אחד. אם יש שולחן בודד שמתאים - ציין אילו (fits_single); אם צריך צירוף (needs_combo) - אמור זאת. שעה מדויקת → בדוק אותה. "בערך ב-X" → בדוק X, ואם מלא נסה גם ±30 דק'. "בערב"/"בצהריים" בלי שעה → בדוק כמה משבצות (למשל 19:00, 20:00, 21:00) ודווח לכל אחת. חסר מספר סועדים → שאל "לכמה אנשים?".
16. **התפנות שולחנות (tables_status):** אין חיזוי מדויק, אבל השתמש ב-occupied_detail: לכל שולחן תפוס יש כמה זמן יושבים (seated_min), כמה נשאר (remaining_min) ודגל ("מעבר לזמן" / "לקראת סיום" / "יושבים"). לשאלה "מתי יתפנה שולחן" הצג את השולחנות עם הזמן הקרוב ביותר להתפנות. אל תמציא - רק מה שבנתונים.
17. **תאריכים וימי שבוע - רק מהלוח.** מצורף לך לוח תאריכים מחושב בקוד. לעולם אל תחשב יום-בשבוע בעצמך, ואל תסמוך על מה שהמשתמש אמר: אם המשתמש שילב תאריך ויום שלא מסתדרים (למשל "יום ראשון 21.9" כשהלוח אומר שזה יום שני) - **עצור והצבע על הסתירה** ("שים לב: 21.9 הוא יום שני. למה התכוונת - יום ראשון 20.9 או יום שני 21.9?"). כשכלי מחזיר weekday_he - זה היום הנכון, השתמש בו בתשובה.
18. **שעות פתיחה הן גבול קשיח.** מצורפות שעות הפתיחה של המסעדה. אין "מקום פנוי" בשעה שהמסעדה סגורה - גם אם טאביט מראה שולחנות ריקים (יום סגור נראה ריק!). לפני כל תשובת זמינות ודא שהשעה בתוך שעות הפעילות של אותו יום (ישיבה עד שעה לפני הסגירה); אם הכלי החזיר closed_at_requested_time - אמור שהמסעדה סגורה/לא מושיבה אז, ציין את השעות, והצע שעה חוקית.
19. **שאלות על שולחן ספציפי - רק דרך tabit_table_schedule.** לעולם אל תגיד "אין הזמנות על שולחן X" על סמך סריקה ידנית של רשימה - קרא לכלי וקח את count/reservations שלו. אם count=0 מותר לומר שאין, וציין לאיזה טווח (scope) זה נבדק. **לא צוין יום בשאלה? אל תעביר day בכלל** - הכלי יכסה את כל הימים הקרובים, וזה מה שהשואל רוצה ("יש הזמנות על 70?" = בכלל, לא רק היום). ציין בתשובה את הטווח.
20. **"אין" דורש הוכחה.** כל טענת שלילה ("אין הזמנה", "לא נמצא", "אין מקום") חייבת להתבסס על תוצאת כלי שכיסתה בדיוק את השאלה. ב-tabit_find_reservation: אם found_on_other_days לא ריק - אל תגיד "לא נמצא"; אמור "לא ביום X, אבל יש הזמנה על השם הזה ביום Y" והצג אותה.
21. **חפש לפני ששואל - בלי יוצאים מהכלל.** "תמצא את ההזמנה של X" עם שם כלשהו (גם שם פרטי בלבד, גם כינוי) = קריאה **מיידית** ל-tabit_find_reservation עם השם, בלי day. לבקש טלפון/יום/שם משפחה לפני שחיפשת זו טעות אסורה - החיפוש זול ועונה לבד: התאמה אחת - הצג אותה; כמה התאמות - הצג את כולן ("יש 3 הזמנות עם 'שני': ...") ושאל איזו; אפס - רק אז אמור שלא נמצא. וזכור: כשלא צוין יום, החיפוש כבר כיסה את **כל הימים הקרובים** - אל תציע "לחפש בימים אחרים" (אין כאלה); אפשר להציע חיפוש לפי שם/טלפון אחר, או תאריך עבר ספציפי (ימי עבר נבדקים רק כשנותנים תאריך).`;

// ===== כלים בצד השרת: חיפוש והצלבה דטרמיניסטיים מעל ה-snapshot / read_day =====

/** שורות הזמנות ליום: יום עבר דרך הסוכן (ארכיון), אחרת מה-snapshot הטרי */
async function rowsForSearch(dayISO: string | null): Promise<{ rows: LabResRow[]; source: string; ageMin: number | null }> {
  if (dayISO && dayISO < todayIL()) {
    const res = (await runCommand("read_day", { day: dayISO }, 45_000)) as { reservations?: LabResRow[] };
    return { rows: res.reservations ?? [], source: "archive", ageMin: null };
  }
  const snap = await loadSnapshot();
  if (!snap?.reservations) throw new Error("אין נתונים זמינים כרגע (ה-snapshot ריק) - נסה רענון חי או בדוק שהסוכן רץ");
  return { rows: snap.reservations, source: "snapshot", ageMin: snapshotAgeMinutes(snap) };
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
    searched: { name: name || null, phone: phone || null, day: dayISO, weekday_he: dayISO ? weekdayHe(dayISO) : null },
    source, ...(ageMin != null ? { data_age_minutes: ageMin } : {}),
  };
  if (onDay.length > 0 || !dayISO) {
    return { ...base, count: onDay.length, matches: onDay.map(rowOut) };
  }
  // לא נמצא ביום המבוקש - מחפשים בכל הימים הקרובים ומדווחים איפה כן
  const elsewhere = filterRows(rows, q);
  return {
    ...base, count: 0, matches: [],
    found_on_other_days: elsewhere.map(rowOut),
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
    day: dayISO, weekday_he: dayISO ? weekdayHe(dayISO) : null,
    scope: dayISO ? "היום המבוקש בלבד" : "כל הימים הקרובים",
    count: matches.length,
    reservations: matches.map(rowOut),
    now_seated,
    source, ...(ageMin != null ? { data_age_minutes: ageMin } : {}),
  };
}

/** מוסיף לכל תוצאה של כלי-יום את היום-בשבוע האמיתי, מחושב בקוד */
function enrichDayResult(input: Record<string, unknown>, out: unknown): unknown {
  const dayISO = resolveDayISO(input.day ?? input.date);
  if (out && typeof out === "object") return { resolved_day: dayISO, weekday_he: weekdayHe(dayISO), ...(out as object) };
  return out;
}

const DAY_ACTIONS = new Set<TabitAction>(["read_day", "big_tables", "covers_summary", "deposit_summary"]);

async function dispatch(name: string, input: Record<string, unknown>): Promise<unknown> {
  // כלים שמחושבים כולם בצד השרת (חיפוש/הצלבה דטרמיניסטיים)
  if (name === "tabit_find_reservation") return serverFindReservation(input);
  if (name === "tabit_table_schedule") return serverTableSchedule(input);

  const action = TOOL_TO_ACTION[name];
  if (!action) throw new Error(`כלי לא מוכר: ${name}`);
  // חוסם פעולות כתיבה בשלב 1 (backstop - הכלי ממילא לא נחשף למודל)
  if (!WRITES_ENABLED && WRITE_TOOL_NAMES.has(name)) throw new Error("פעולות כתיבה מושבתות בשלב 1 (קריאה בלבד)");

  // שער שעות הפתיחה (דטרמיניסטי): זמינות בשעה שהמסעדה סגורה לא מגיעה בכלל
  // לטאביט - ביום סגור "הכל פנוי" ולכן בלי השער הזה הבוט מאשר בביטחון שעה סגורה.
  if (name === "tabit_check_availability") {
    const date = String(input.date ?? "");
    const time = String(input.time ?? "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{1,2}:\d{2}$/.test(time)) {
      const cfg = await loadBusinessConfig();
      const gate = checkOpenAt(cfg, date, time);
      if (!gate.open) {
        return {
          date, time, weekday_he: gate.weekday_he,
          closed_at_requested_time: true,
          hours_that_day: gate.hours_that_day ?? "סגור",
          message: gate.hours_that_day
            ? `המסעדה לא מקבלת סועדים ב-${time} ביום ${gate.weekday_he} (שעות הפעילות: ${gate.hours_that_day}, ישיבה עד שעה לפני הסגירה). אל תדווח זמינות - הצע שעה בתוך שעות הפעילות.`
            : `המסעדה סגורה ביום ${gate.weekday_he} ${date}. אל תדווח זמינות.`,
        };
      }
      const out = await runCommand(action, input, 45_000);
      if (out && typeof out === "object") return { weekday_he: gate.weekday_he, hours_that_day: gate.hours_that_day, ...(out as object) };
      return out;
    }
  }

  // הסוכן המקומי סוקר עד כל 15 שניות במצב שקט, לכן הפקודה הראשונה עשויה לחכות
  // רגע להיתפס. יצירה מקבלת timeout ארוך יותר (יצירה + שליפת הקישור).
  const timeout = action === "create_reservation" ? 70_000 : 45_000;
  const out = await runCommand(action, input, timeout);
  return DAY_ACTIONS.has(action) ? enrichDayResult(input, out) : out;
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
}
export interface TabitChatResult {
  reply: string;
  toolLog: TabitToolLogEntry[];
}

/**
 * מריץ סבב שיחה מול טאביט (עד 5 סבבי כלים) ומחזיר תשובה + לוג כלים.
 * forceReadOnly: כופה חשיפת כלי-קריאה בלבד (בוט הקבוצה תמיד כזה).
 * extraSystem: הנחיית מערכת נוספת (למשל פורמט קבוצת וואטסאפ).
 * זורק אם חסר ANTHROPIC_API_KEY - הקורא מטפל.
 */
export async function runTabitChat(
  history: TabitChatMessage[],
  opts?: { forceReadOnly?: boolean; extraSystem?: string }
): Promise<TabitChatResult> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("missing ANTHROPIC_API_KEY");

  const effectiveWrites = WRITES_ENABLED && !opts?.forceReadOnly;
  const tools = effectiveWrites ? TOOLS : READ_TOOLS;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 60_000 });
  const msgs: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));
  const toolLog: TabitToolLogEntry[] = [];

  // לוח התאריכים ושעות הפתיחה - מחושבים בקוד ומוזרקים לכל שיחה (כלל 17-18).
  // אם הקונפיג לא נטען מסיבה כלשהי, ממשיכים בלי בלוק השעות (עדיף תשובה מתשובת שגיאה).
  let hoursText = "";
  try {
    hoursText = hoursBlock(await loadBusinessConfig());
  } catch { /* בלי שעות - הכללים עדיין תקפים */ }

  // הפרומפט+כלים הסטטיים במטמון (ttl 1h); הבלוק הדינמי (שעה/לוח/שעות פתיחה) נפרד כדי לא לפספס מטמון.
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: SYSTEM, cache_control: { type: "ephemeral", ttl: "1h" } },
    { type: "text", text: [`השעה בישראל כעת: ${israelNow()}.`, calendarBlock(), hoursText].filter(Boolean).join("\n\n") },
  ];
  if (!effectiveWrites)
    system.push({ type: "text", text: "הערה: פעולות כתיבה (יצירה/שינוי/ביטול הזמנה) מושבתות כרגע. בשלב הזה אתה רק מושך מידע. אם מבקשים לבצע פעולה כזו, אמור בפשטות שזה עדיין לא זמין." });
  if (opts?.extraSystem) system.push({ type: "text", text: opts.extraSystem });

  for (let i = 0; i < 5; i++) {
    const resp = await anthropic.messages.create({ model: MODEL, max_tokens: 3000, system, tools, messages: msgs });
    await recordLlmUsage(MODEL, resp.usage, false, "tabit-lab");
    const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    msgs.push({ role: "assistant", content: resp.content });

    if (!toolUses.length) {
      const text = resp.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text).join("\n").trim();
      return { reply: text || "(אין תשובה)", toolLog };
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
      toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out).slice(0, 40000), is_error: !ok });
    }
    msgs.push({ role: "user", content: toolResults });
  }

  return { reply: "(עצרתי אחרי כמה סבבי כלים - נסה שוב או פשט את הבקשה)", toolLog };
}
