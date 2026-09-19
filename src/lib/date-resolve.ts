/**
 * פענוח תאריך דטרמיניסטי מטקסט של לקוח - לוגיקה טהורה, בלי מסד ובלי שעון.
 *
 * עבר לכאן מ-reservations.ts ב-19.9 כדי שגם day-context.ts (שמזריק למודל
 * "איזה יום הלקוח התכוון") יוכל להשתמש **באותו פענוח בדיוק** בלי למשוך איתו
 * את המסד וההתראות. שני פענוחים נפרדים לאותה מילה הם בדיוק מה שהטעה את הבוט:
 * רמז אחד אמר 20.9 כשהלקוח התכוון ל-27.9.
 *
 * למה בכלל בקוד: המודל טועה בחישובי תאריכים (12.8: "מחר" נדד בין 13.8 ל-14.8
 * באותה שיחה, והטעות התפשטה ליומן ולתשובות הצוות).
 */

export const HE_DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

/** התאריך (YYYY-MM-DD) והיום-בשבוע הנוכחיים בישראל */
export function israelToday(now: Date): { iso: string; dow: number } {
  const iso = now.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", weekday: "short" }).format(now);
  return { iso, dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd) };
}

function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * מילים שאחרי "שני" הופכות אותו למספר ולא ליום בשבוע. "שולחן לשני אנשים"
 * נקרא עד 19.9 כ"יום שני" - וזה הניסוח הכי נפוץ שיש לזוג.
 */
const COUNT_AFTER_SHENI =
  /^\s*(?:אנשים|סועדים|מקומות|שולחנות|זוגות|ילדים|מבוגרים|חברים|חברות|אורחים|כיסאות|כסאות|בני|פעמים|ימים|שבועות|מנות|דקות|שעות)(?![א-ת])/;

export interface WeekdayMention {
  /** הטקסט כפי שנכתב ("יום ראשון הבא") - להצגה למודל */
  raw: string;
  /** 0=ראשון .. 6=שבת */
  dow: number;
  /** נאמר "X הבא" */
  next: boolean;
}

/**
 * יום בשבוע שהלקוח הזכיר, או null. "שבוע הבא" לבדו אינו יום.
 * מתעלם מ"שני אנשים" (מספר) ומ"ראשון לציון" (עיר).
 */
export function weekdayMentionIn(text: string): WeekdayMention | null {
  const t = text || "";
  for (let i = 0; i < HE_DAYS.length; i++) {
    const rx = new RegExp(`(?:^|[\\s,בלו])((?:יום\\s+)?${HE_DAYS[i]})(?=$|[\\s,.!?])`, "g");
    for (const m of t.matchAll(rx)) {
      const after = t.slice((m.index ?? 0) + m[0].length);
      if (i === 1 && COUNT_AFTER_SHENI.test(after)) continue;
      if (i === 0 && /^\s*לציון/.test(after)) continue;
      const nextM = after.match(/^\s+(הבא|הבאה)(?![א-ת])/);
      return { raw: nextM ? `${m[1]} ${nextM[1]}` : m[1], dow: i, next: !!nextM };
    }
  }
  return null;
}

/**
 * כמה ימים קדימה נמצא היום שהוזכר.
 *
 * nextWeek ("שבוע הבא" בהודעה או קודם בשיחה): המופע חייב ליפול בשבוע הקלנדרי
 * הבא (ראשון-שבת). בלי זה "לשבוע הבא" ואז "שישי", ביום שישי, נפתר להיום (18.9).
 *
 * "X הבא" כש-X הוא היום או מחר: על מחר אומרים "מחר", ולכן "ראשון הבא" שנאמר
 * בשבת הוא ראשון של השבוע שאחרי. בלי זה, לקוח ששמע שמחר (ראשון) סגורים וענה
 * "אז ליום ראשון הבא" קיבל שוב את מחר (19.9). כש-X רחוק יותר ("חמישי הבא"
 * בשבת) זה המופע הקרוב, כמו שמדברים.
 */
export function weekdayOffset(todayDow: number, dow: number, opts?: { nextWeek?: boolean; dayNext?: boolean }): number {
  let ahead = (dow - todayDow + 7) % 7;
  if (opts?.nextWeek) {
    const daysToNextSunday = (7 - todayDow) % 7 || 7;
    if (ahead < daysToNextSunday) ahead += 7;
  }
  if (opts?.dayNext && ahead <= 1) ahead += 7;
  return ahead;
}

/** "בעוד שבועיים" וכד' - שם באמת אי אפשר לדעת, ולא מכריעים */
function isVagueWeek(t: string): boolean {
  const saysNextWeek = /(ה)?שבוע הבא/.test(t);
  return /בעוד/.test(t) || (/שבוע/.test(t) && !saysNextWeek);
}

/**
 * היום בשבוע שבטקסט, כתאריך. null כשאין יום, או כשהוא עמום ("בעוד שבועיים").
 * refISO/refDow = היום שבו הלקוח **כתב** (לא היום שבו עונים).
 */
export function weekdayDateIn(
  text: string,
  refISO: string,
  refDow: number,
  opts?: { nextWeek?: boolean }
): { raw: string; iso: string } | null {
  const t = (text || "").trim();
  if (isVagueWeek(t)) return null;
  const w = weekdayMentionIn(t);
  if (!w) return null;
  const nextWeek = /(ה)?שבוע הבא/.test(t) || opts?.nextWeek === true;
  return { raw: w.raw, iso: addDaysISO(refISO, weekdayOffset(refDow, w.dow, { nextWeek, dayNext: w.next })) };
}

/**
 * גוזר את תאריך ההזמנה (ISO) ממילות הלקוח: "היום"/"מחר"/"מחרתיים", יום בשבוע,
 * או תאריך מפורש ("13.8"). כשאי אפשר לגזור בוודאות - נופל להערכת המודל
 * (רק אם תקינה ולא בעבר), אחרת undefined והצוות מסתמך על dateText.
 */
export function resolveReservationDate(
  dateText: string,
  modelISO?: string,
  now: Date = new Date(),
  opts?: { nextWeek?: boolean }
): string | undefined {
  const { iso: today, dow: todayDow } = israelToday(now);
  const t = (dateText || "").trim();
  const modelFallback =
    modelISO && /^\d{4}-\d{2}-\d{2}$/.test(modelISO) && modelISO >= today ? modelISO : undefined;

  if (/מחרתיים/.test(t)) return addDaysISO(today, 2);
  if (/מחר/.test(t)) return addDaysISO(today, 1);
  if (/היום|הערב|הלילה/.test(t)) return today;

  // תאריך מפורש "13.8" / "13/8" / "13.8.26" - קודם ליום-בשבוע (ספציפי יותר)
  const em = t.match(/(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/);
  if (em) {
    const d = Number(em[1]);
    const mo = Number(em[2]);
    let y = em[3] ? Number(em[3]) : Number(today.slice(0, 4));
    if (y < 100) y += 2000;
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      const mk = (yy: number) => `${yy}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      // בלי שנה מפורשת ותאריך שכבר עבר - כנראה הכוונה לשנה הבאה
      return !em[3] && mk(y) < today ? mk(y + 1) : mk(y);
    }
  }

  // יום בשבוע ("יום חמישי", "בחמישי", "ראשון הבא") - אותו יום כמו היום = היום
  // (הצוות מאמת ממילא)
  const wd = weekdayDateIn(t, today, todayDow, opts);
  if (wd) return wd.iso;

  return modelFallback;
}
