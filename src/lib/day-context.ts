/**
 * פענוח מילות זמן יחסיות ("היום", "מחר", "הערב") - בקוד, לא במודל.
 *
 * למה זה קיים, שתי תקלות אמיתיות מ-17.9:
 *
 * 1. לקוח כתב ב-23:30 ביום רביעי "מקום למחר בערב". הבוט נפל (נגמרו הקרדיטים),
 *    ונציג החזיר את השיחה אליו ב-00:05. אז המודל קיבל "עכשיו יום חמישי 00:05"
 *    וענה שמחר זה שישי ואין הזמנות. הלקוח דיבר על חמישי.
 *    -> **מילת זמן נפתרת לפי מתי הלקוח כתב אותה, לא לפי מתי אנחנו עונים.**
 *
 * 2. אחרי חצות "מחר" של הדובר הוא בדרך כלל היום הקלנדרי שזה עתה התחיל, כי
 *    מבחינתו הלילה עוד לא נגמר. זו סטייה של יום שלם, והיא שקטה.
 *    -> **בין 00:00 ל-05:00 לא מנחשים: שואלים.**
 *
 * הלוגיקה כאן טהורה לגמרי (מקבלת חותמות זמן, לא קוראת לשעון) כדי שאפשר יהיה
 * לבדוק אותה עם זמנים קבועים. הבדיקות: scripts/day-context-test.mts.
 */

const HE_DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

/** סוף חלון "אחרי חצות" בדקות מחצות. עד 05:00 הדובר עדיין חושב שזה אתמול. */
export const MIDNIGHT_WINDOW_END_MIN = 5 * 60;

export interface IsraelParts {
  /** YYYY-MM-DD בשעון ישראל */
  dateISO: string;
  /** דקות מחצות */
  minutes: number;
  /** HH:MM */
  hhmm: string;
}

/** התאריך והשעה בישראל ברגע נתון. */
export function israelPartsAt(ms: number): IsraelParts {
  const d = new Date(ms);
  const dateISO = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  const hhmm = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
  const [h, m] = hhmm.split(":").map(Number);
  return { dateISO, minutes: h * 60 + m, hhmm };
}

/** הוספת ימים לתאריך ISO (חשבון על לוח השנה, בלי אזורי זמן). */
export function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

/** "יום חמישי 17.9" */
export function formatDayHe(dateISO: string): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `יום ${HE_DAYS[dow]} ${d}.${m}`;
}

/** האם הרגע הזה נופל בחלון שאחרי חצות (00:00-05:00 שעון ישראל). */
export function inMidnightWindow(ms: number): boolean {
  return israelPartsAt(ms).minutes < MIDNIGHT_WINDOW_END_MIN;
}

// ===== זיהוי מילות זמן יחסיות =====

/**
 * גבול מילה בעברית: \b של JavaScript מבוסס על [A-Za-z0-9_] בלבד, ולכן הוא
 * מתנהג הפוך על עברית. משתמשים בבדיקת "לא אות" משני הצדדים.
 */
const NOT_LETTER_BEFORE = "(^|[^\\p{L}])";
const NOT_LETTER_AFTER = "(?![\\p{L}])";

/**
 * אותיות השימוש נדבקות למילה בעברית: "למחר", "מהיום", "שהיו", "ובערב".
 * בלי לאפשר אות מחוברת אחת, "רוצה שולחן **למחר**" לא זוהה בכלל - וזה בדיוק
 * הניסוח הנפוץ. נתפס על ידי הבדיקות לפני שהגיע לקוד החי.
 */
const HE_PREFIX = "[לבהוכשמ]?";

/** ביטוי למילה עברית שלמה, כולל אות שימוש מחוברת אפשרית. */
function heWordRx(word: string, flags = "u"): RegExp {
  return new RegExp(`${NOT_LETTER_BEFORE}${HE_PREFIX}${word}${NOT_LETTER_AFTER}`, flags);
}

export interface RelativeWord {
  word: string;
  /** כמה ימים מהיום של הכותב */
  offsetDays: number;
  /**
   * האם המילה מסוכנת אחרי חצות. "היום" בטוחה (הדובר והלוח מתכוונים לאותו יום
   * הקלנדרי החדש ברוב המוחלט של המקרים); "מחר" מסוכנת (סטייה של יום).
   */
  riskyAfterMidnight: boolean;
}

const RELATIVE_WORDS: RelativeWord[] = [
  { word: "מחרתיים", offsetDays: 2, riskyAfterMidnight: true },
  { word: "מחר", offsetDays: 1, riskyAfterMidnight: true },
  { word: "הלילה", offsetDays: 0, riskyAfterMidnight: true },
  { word: "הערב", offsetDays: 0, riskyAfterMidnight: true },
  { word: "היום", offsetDays: 0, riskyAfterMidnight: false },
  { word: "אתמול", offsetDays: -1, riskyAfterMidnight: true },
  { word: "שלשום", offsetDays: -2, riskyAfterMidnight: true },
];

/**
 * "בשעות הערב" / "בשעות הלילה" הן תיאור כללי של פרק ביום, לא הפניה לתאריך
 * ("הזמנות מתקבלות לשעות הערב"). בלי החריג הזה כל אזכור של המדיניות שלנו היה
 * מפעיל את שער החצות.
 */
const GENERIC_EVENING = new RegExp(`שעות\\s+(הערב|הלילה|היום)${NOT_LETTER_AFTER}`, "gu");

/** מילות הזמן היחסיות שמופיעות בטקסט, לפי סדר ההופעה. */
export function relativeWordsIn(text: string): RelativeWord[] {
  const out: RelativeWord[] = [];
  const cleaned = text.replace(GENERIC_EVENING, " ");
  for (const w of RELATIVE_WORDS) {
    if (heWordRx(w.word).test(cleaned)) out.push(w);
  }
  // "מחרתיים" מכילה את "מחר"? לא - הלוקאהד חוסם. אבל אם שתיהן באמת נאמרו,
  // הראשונה ברשימה (הרחוקה) היא זו שקובעת, כי היא הספציפית יותר.
  return out;
}

/**
 * האם בטקסט יש יום או תאריך מפורש, שמייתר כל שאלת הבהרה.
 *
 * מכוון בכוונה לצד הצר: אם נפספס תאריך מפורש נשאל שאלה מיותרת (מעצבן), ואם
 * נזהה בטעות תאריך שאינו קיים נדלג על השאלה (מסוכן). "שני" לבדה אינה נחשבת -
 * "שני אנשים" הוא השימוש הנפוץ בהרבה.
 */
export function hasExplicitDate(text: string): boolean {
  // תאריך מספרי. ⚠️ ישראלים כותבים שעה כ-"21.30", ולכן החלק השני חייב להיות
  // חודש חוקי: 21.30 נפסל (אין חודש 30) ו-17.9 מתקבל. בלי ההבחנה הזאת
  // "מחר ב-21.30" היה נחשב "תאריך מפורש" ושער החצות היה מדלג עליו בשקט.
  for (const m of text.matchAll(/(^|[^\d:])(\d{1,2})[./-](\d{1,2})(?![\d:])/g)) {
    const day = Number(m[2]);
    const month = Number(m[3]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) return true;
  }
  const days = HE_DAYS.join("|");
  if (new RegExp(`${NOT_LETTER_BEFORE}(ב|ל)?יום\\s+(${days})${NOT_LETTER_AFTER}`, "u").test(text)) return true;
  if (new RegExp(`${NOT_LETTER_BEFORE}(ב|ל)?שבת${NOT_LETTER_AFTER}`, "u").test(text)) return true;
  return false;
}

// ===== לשון עבר מול הווה/עתיד (לשימוש המעבדה) =====

const PAST_RX = heWordRx(
  `(היה|היו|הייתה|היתה|היינו|הגיע|הגיעו|באו|ישבו|אכלו|שילמו|` +
    `עשינו|עשו|הכנסנו|הרווחנו|מכרנו|סגרנו|קיבלנו|ביקרו|נכנסו|התקבלו|שירתנו|` +
    `בוטלו|ביטלו|התבטלו|פדיון|מחזור)`
);

const FUTURE_RX = heWordRx(
  `(יש|יהיה|יהיו|יגיע|יגיעו|מגיע|מגיעים|צפוי|צפויים|` +
    `פנוי|פנויים|פנויות|זמין|זמינים|מוזמן|מוזמנים|רשום|רשומות|רשומים|נשאר|נשארו|` +
    `נותרו|קיים|קיימות)`
);

export type Tense = "past" | "future" | "unknown";

/** לשון הפנייה. "גם וגם" מוחזר כ-unknown בכוונה: עדיף לשאול מאשר לנחש. */
export function tenseOf(text: string): Tense {
  const past = PAST_RX.test(text);
  const future = FUTURE_RX.test(text);
  if (past && !future) return "past";
  if (future && !past) return "future";
  return "unknown";
}

// ===== ההקשר שמוזרק לבוט הלקוחות =====

export interface DayHint {
  /** השורה שנשלחת למודל */
  line: string;
  /** האם לעצור ולוודא לפני שפועלים */
  needsConfirm: boolean;
}

/**
 * ההקשר על מילת הזמן בהודעת הלקוח.
 *
 * writtenAtMs = מתי **הלקוח** כתב. nowMs = מתי אנחנו עונים. ההפרש חשוב:
 * הודעה שנכתבה ב-23:30 ונענית ב-00:05 נפתרת לפי 23:30.
 *
 * alreadyAsked = כבר שאלנו פעם אחת בפרק הזה. אז לא שואלים שוב, פותרים לפי
 * זמן הכתיבה ואומרים למודל במפורש לאיזה תאריך - חקירה חוזרת גרועה משגיאה.
 */
export function dayHintForMessage(
  text: string,
  writtenAtMs: number,
  nowMs: number,
  alreadyAsked = false
): DayHint | null {
  const words = relativeWordsIn(text);
  if (!words.length) return null;

  const written = israelPartsAt(writtenAtMs);
  const resolve = (w: RelativeWord) => addDaysISO(written.dateISO, w.offsetDays);

  const risky = words.filter((w) => w.riskyAfterMidnight);
  if (risky.length && inMidnightWindow(writtenAtMs) && !hasExplicitDate(text) && !alreadyAsked) {
    const w = risky[0];
    // אחרי חצות הדובר עדיין חי ביום שהסתיים, ולכן המילה שלו מצביעה יום אחד
    // אחורה מהחישוב הקלנדרי. שתי האפשרויות אמיתיות ואין דרך לדעת - שואלים.
    const asSpoken = addDaysISO(written.dateISO, w.offsetDays - 1);
    const asCalendar = resolve(w);
    return {
      needsConfirm: true,
      line:
        `⚠️ הלקוח כתב "${w.word}" בשעה ${written.hhmm}, כלומר אחרי חצות, ולכן המילה עמומה: ` +
        `היא יכולה להיות ${formatDayHe(asSpoken)} או ${formatDayHe(asCalendar)}. ` +
        `**אל תענה לגופו של עניין ואל תבצע שום פעולה לפני שתוודא איתו על איזה יום מדובר.** ` +
        `שאל שאלה קצרה אחת עם שתי האפשרויות הקונקרטיות (יום ותאריך), בטבעיות, ` +
        `בלי להסביר לו למה אתה שואל ובלי להזכיר חצות או שעות.`,
    };
  }

  const parts = words.map((w) => `"${w.word}" = ${formatDayHe(resolve(w))}`);
  const gapMin = Math.round((nowMs - writtenAtMs) / 60_000);
  // מציינים את זמן הכתיבה רק כשהוא באמת שונה מעכשיו, אחרת זה רעש מיותר בכל הודעה
  const when =
    gapMin >= 10
      ? ` (ההודעה נכתבה ב${formatDayHe(written.dateISO)} בשעה ${written.hhmm}, לפני ${gapMin} דקות - התאריכים נפתרו לפי רגע הכתיבה ולא לפי עכשיו)`
      : "";
  return {
    needsConfirm: false,
    line: `פענוח מילות הזמן בהודעת הלקוח, מחושב בקוד: ${parts.join(", ")}${when}. השתמש בזה, אל תחשב בעצמך.`,
  };
}

// ===== ההקשר שמוזרק לצ'אט המעבדה =====

/**
 * במעבדה מדבר הצוות, לא לקוח, והשאלות שלו רטרוספקטיביות לא פחות מאשר צופות
 * פני עתיד ("כמה אנשים היה היום?" ב-00:05 = היום שהסתיים). לכן כאן לשון
 * הפנייה היא שקובעת, ולא מגיעים לשאלת הבהרה אלא כשבאמת אין דרך לדעת:
 *
 *   "היום"/"הערב"/"הלילה" + לשון עבר  -> היום שהסתיים (אתמול בלוח)
 *   "היום"/"הערב"/"הלילה" אחרת        -> היום הקלנדרי החדש
 *   "מחר"/"מחרתיים"/"אתמול"/"שלשום"   -> שואל (סטייה של יום, ואין לה סימן מזהה)
 */
export function labDayHint(text: string, nowMs: number, alreadyAsked = false): DayHint | null {
  if (!inMidnightWindow(nowMs)) return null;
  const words = relativeWordsIn(text);
  if (!words.length || hasExplicitDate(text)) return null;

  const now = israelPartsAt(nowMs);
  const yesterday = addDaysISO(now.dateISO, -1);
  const tense = tenseOf(text);

  const sameDayWords = words.filter((w) => w.offsetDays === 0);
  const shiftedWords = words.filter((w) => w.offsetDays !== 0);

  if (shiftedWords.length && !alreadyAsked) {
    const w = shiftedWords[0];
    const asSaid = addDaysISO(now.dateISO, w.offsetDays);
    const asSpoken = addDaysISO(now.dateISO, w.offsetDays - 1);
    return {
      needsConfirm: true,
      line:
        `⚠️ השעה ${now.hhmm}, כלומר אחרי חצות, והמילה "${w.word}" עמומה: ` +
        `${formatDayHe(asSpoken)} או ${formatDayHe(asSaid)}. ` +
        `אל תריץ כלים ואל תענה לפני שתשאל איזו מהשתיים.`,
    };
  }

  if (sameDayWords.length) {
    const w = sameDayWords[0];
    if (tense === "past") {
      return {
        needsConfirm: false,
        line:
          `השעה ${now.hhmm} (אחרי חצות) והשאלה בלשון עבר, ולכן "${w.word}" = ` +
          `**${formatDayHe(yesterday)}**, היום שזה עתה הסתיים - ולא ${formatDayHe(now.dateISO)}. ` +
          `השתמש בתאריך ${yesterday}, וציין בתשובה במפורש על איזה יום ענית.`,
      };
    }
    return {
      needsConfirm: false,
      line:
        `השעה ${now.hhmm} (אחרי חצות). "${w.word}" כאן = **${formatDayHe(now.dateISO)}** ` +
        `(היום הקלנדרי שהתחיל). ציין בתשובה במפורש על איזה יום ענית, כדי שאפשר יהיה לתקן אותך במילה.`,
    };
  }

  if (shiftedWords.length) {
    // כבר שאלנו פעם אחת - פותרים לפי הלוח ומצהירים, במקום לשאול שוב
    const w = shiftedWords[0];
    return {
      needsConfirm: false,
      line: `"${w.word}" = ${formatDayHe(addDaysISO(now.dateISO, w.offsetDays))}. ציין בתשובה על איזה יום ענית.`,
    };
  }
  return null;
}
