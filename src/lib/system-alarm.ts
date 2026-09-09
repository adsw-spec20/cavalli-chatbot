/**
 * אזעקת מערכת: מתי להציג לצוות באנר אדום "הבוט לא מצליח לענות".
 *
 * הכלל של בעל העסק (9.9): תקלה רגעית שהסתדרה מיד לא מצדיקה באנר קבוע בראש
 * המסך. תקלה שנמשכת - כן, והיא צריכה להישאר.
 *
 * למה זה לא עבד עד 9.9: הבאנר כובה ברגע שתשובה אחת הצליחה, והדגל "יש אזעקה"
 * ישב בזיכרון של מופע שרת בודד. בנפילת הקרדיטים של 9.9 חלק מהבקשות הזולות
 * כן עברו מדי פעם, כל הצלחה כזאת כיבתה את הבאנר, והוא נדלק ונכבה חליפות -
 * כלומר נפילה ארוכה נראתה למערכת כמו סדרה של תקלות רגעיות. בפועל הבוט היה
 * מושבת זמן רב ואף אחד לא ידע.
 *
 * הפתרון כאן: לא מחליטים לפי הצלחה בודדת ולא לפי זיכרון של מופע. שומרים
 * ב-DB מתי התחילו הכשלים, מתי היה האחרון, וכמה היו. ההחלטה אם להציג באנר
 * נגזרת מהנתונים האלה בזמן הקריאה:
 *
 *   - כשל בודד שהסתדר      -> אין באנר לעולם.
 *   - כשלים שנמשכים        -> באנר, וממשיך להופיע כל עוד הם נמשכים.
 *   - הכשלים פסקו          -> הבאנר נעלם מעצמו אחרי חלון שקט.
 *
 * יתרון נוסף: מסלול ההצלחה לא נוגע ב-DB בכלל. הכתיבה קורית רק בכשל, שהוא נדיר.
 */

import { getRepo } from "./db";

const KEY = "api_alarm";

/** מאיזה רגע כשלים נחשבים "נמשכים" ולא בליפ */
const SUSTAINED_MS = 60_000;
/** או לחלופין: כמה לקוחות צריכים לחטוף כדי שזה ייחשב אמיתי גם אם זה קרה מהר */
const SUSTAINED_COUNT = 3;
/** כמה זמן בלי אף כשל חדש עד שהבאנר נעלם מעצמו */
const QUIET_MS = 10 * 60_000;
/** רשומה ישנה מכדי להיות רלוונטית (רשת ביטחון נגד באנר תקוע) */
const MAX_AGE_MS = 24 * 3600_000;

export type AlarmReason = "credit" | "api";

interface AlarmRecord {
  /** מתי נרשם הכשל הראשון ברצף הנוכחי */
  firstTs: number;
  /** מתי נרשם הכשל האחרון */
  lastTs: number;
  /** כמה לקוחות נפגעו ברצף הזה */
  count: number;
  reason: AlarmReason;
  sample?: string;
}

/** מה שהפאנל מקבל: רק אזעקה שבאמת צריך להציג */
export interface ActiveAlarm {
  ts: number;
  reason: AlarmReason;
  sample?: string;
  /** כמה לקוחות נפגעו - הצוות רואה שזו לא תקלה בודדת */
  count: number;
}

async function read(): Promise<AlarmRecord | null> {
  try {
    const raw = await getRepo().getSetting(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AlarmRecord> & { ts?: number };
    // תאימות לרשומות מהפורמט הישן ({ts, reason, sample}) - נחשבות ככשל בודד
    const firstTs = parsed.firstTs ?? parsed.ts;
    const lastTs = parsed.lastTs ?? parsed.ts;
    if (!firstTs || !lastTs) return null;
    return {
      firstTs,
      lastTs,
      count: parsed.count ?? 1,
      reason: parsed.reason === "credit" ? "credit" : "api",
      sample: parsed.sample,
    };
  } catch {
    return null;
  }
}

/** האם הרצף הזה כבר נחשב "תקלה נמשכת" */
function isSustained(r: AlarmRecord): boolean {
  return r.lastTs - r.firstTs >= SUSTAINED_MS || r.count >= SUSTAINED_COUNT;
}

/**
 * רישום כשל שבו לקוח אמיתי קיבל הודעת תקלה.
 * מחזיר true אם הרצף חצה **עכשיו** את הסף להיחשב נמשך - זה הרגע לשלוח
 * התראת וואטסאפ לצוות, ולא בכל כשל בודד.
 */
export async function recordModelFailure(
  reason: AlarmReason,
  sample?: string
): Promise<{ becameSustained: boolean }> {
  const now = Date.now();
  const prev = await read();

  // רצף חדש: אין רשומה, או שהקודמת כבר התיישנה (חלון שקט חלף)
  const continuing = prev && now - prev.lastTs < QUIET_MS && now - prev.firstTs < MAX_AGE_MS;
  const next: AlarmRecord = continuing
    ? { firstTs: prev!.firstTs, lastTs: now, count: prev!.count + 1, reason, sample }
    : { firstTs: now, lastTs: now, count: 1, reason, sample };

  const wasSustained = continuing ? isSustained(prev!) : false;
  const nowSustained = isSustained(next);

  try {
    await getRepo().setSetting(KEY, JSON.stringify(next));
  } catch (err) {
    // לא בולעים בשקט: אם אי אפשר לרשום את האזעקה, זה עצמו ממצא שצריך להופיע בלוג
    console.error("[system-alarm] רישום האזעקה נכשל:", err instanceof Error ? err.message : err);
  }

  return { becameSustained: nowSustained && !wasSustained };
}

/**
 * מה להציג בפאנל. מחזיר null כשאין מה להציג:
 * תקלה בודדת שהסתדרה, או רצף שפסק והחלון השקט עבר.
 */
export async function readActiveAlarm(): Promise<ActiveAlarm | null> {
  const r = await read();
  if (!r) return null;
  const now = Date.now();
  // הכשלים פסקו מספיק זמן, או שהרשומה עתיקה - הבאנר יורד מעצמו
  if (now - r.lastTs >= QUIET_MS || now - r.firstTs >= MAX_AGE_MS) return null;
  // תקלה בודדת/קצרה - בדיוק מה שביקשנו לא להציג
  if (!isSustained(r)) return null;
  return { ts: r.lastTs, reason: r.reason, sample: r.sample, count: r.count };
}

/** כיבוי ידני מהפאנל, אחרי שהצוות טיפל */
export async function clearAlarm(): Promise<void> {
  await getRepo().setSetting(KEY, "");
}
