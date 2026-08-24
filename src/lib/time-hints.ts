/**
 * פענוח שעות "חשופות" מול השעה הנוכחית.
 *
 * למה זה קיים (תקרית Mike, 24.8): לקוח כתב ב-21:01 "I have reservation for 10:30
 * but I'm starving can I come at 10". הבוט ענה "We're open from 8:00, so 10:00
 * works perfectly" - כלומר קרא "10" כ-10 בבוקר, בשעה תשע בערב. שוחזר 6/6 בקוד
 * הנוכחי ו-4/6 בקוד הישן, כלומר זו חולשה עקבית של המודל ולא רגרסיה.
 *
 * הפתרון זהה לזה שכבר עשינו לתאריכים: הקוד מפענח, המודל לא מנחש. שעה 1-12 בלי
 * ציון בוקר/ערב מפוענחת ל**מופע הקרוב ביותר בעתיד** - בדיוק כמו שאדם היה מבין.
 */

/** מילות הקשר שמסירות את העמימות בעצמן - אז אין מה לפענח */
const EXPLICIT_AMPM = /\b(am|pm|a\.m|p\.m)\b|בבוקר|בצהר?יים|בערב|בלילה|morning|evening|noon|midnight|tonight\s+at\s+\d{1,2}\s*(am|pm)/i;

/** מילים שמעידות שהמספר הוא כמות אנשים ולא שעה */
const PEOPLE_AFTER = /^\s*(אנשים|איש|סועדים|נפשות|מקומות|people|guests|persons?)/i;

interface Found {
  raw: string;
  hour: number;
  minute: number;
}

/** מאתר אזכורי שעה עמומים (1-12, בלי ציון בוקר/ערב) */
function findBareHours(text: string): Found[] {
  const out: Found[] = [];
  // שעה אחרי מילת יחס של זמן, או שעה עם דקות (HH:MM) בכל מקום
  const rx =
    /(?:\b(?:at|for|until|till|by|around)\s+|(?:^|\s)(?:ב|בשעה|ל|עד|בערך)\s?-?\s?)(\d{1,2})(?::([0-5]\d))?(?![\d:])|(?:^|\s)(\d{1,2}):([0-5]\d)(?![\d:])/gi;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text)) !== null) {
    const hour = Number(m[1] ?? m[3]);
    const minute = Number(m[2] ?? m[4] ?? 0);
    if (!Number.isFinite(hour) || hour < 1 || hour > 12) continue; // 13:00+ חד-משמעי
    // "ל-4 אנשים" זו כמות, לא שעה
    if (PEOPLE_AFTER.test(text.slice(m.index + m[0].length))) continue;
    const raw = m[2] || m[4] ? `${hour}:${String(minute).padStart(2, "0")}` : String(hour);
    if (!out.some((o) => o.raw === raw)) out.push({ raw, hour, minute });
  }
  return out;
}

/** השעה והדקה הנוכחיות בישראל */
function israelNow(now: Date): { h: number; m: number } {
  const s = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  const [h, m] = s.split(":").map(Number);
  return { h, m };
}

/**
 * מחזיר משפט פענוח למודל, או null כשאין מה לפענח.
 * הכלל: מבין שתי האפשרויות (H ו-H+12) נבחרת זו שמגיעה **קרוב יותר בעתיד** -
 * ב-21:00 "10" הוא 22:00 ולא 10 בבוקר מחר; ב-09:00 "10" הוא 10:00.
 */
export function bareHourHint(text: string, now: Date = new Date()): string | null {
  const t = (text ?? "").trim();
  if (!t || t.length > 400) return null;
  if (EXPLICIT_AMPM.test(t)) return null; // הלקוח כבר אמר בוקר/ערב

  const found = findBareHours(t);
  if (!found.length) return null;

  const { h: nowH, m: nowM } = israelNow(now);
  const nowMinutes = nowH * 60 + nowM;

  const parts: string[] = [];
  for (const f of found) {
    const asIs = f.hour * 60 + f.minute;
    const asPm = ((f.hour % 12) + 12) * 60 + f.minute;
    // כמה דקות קדימה כל אפשרות (מחזוריות של 24 שעות)
    const ahead = (x: number) => (x - nowMinutes + 1440) % 1440;
    const chosen = ahead(asIs) <= ahead(asPm) ? asIs : asPm;
    const hh = String(Math.floor(chosen / 60)).padStart(2, "0");
    const mm = String(chosen % 60).padStart(2, "0");
    if (`${hh}:${mm}` !== `${String(f.hour).padStart(2, "0")}:${String(f.minute).padStart(2, "0")}`) {
      parts.push(`"${f.raw}" = ${hh}:${mm}`);
    }
  }
  if (!parts.length) return null;

  return (
    `פענוח השעות שהלקוח כתב (חושב בקוד לפי השעה הנוכחית, זה מדויק): ${parts.join(", ")}. ` +
    `השתמש בפענוח הזה, אל תניח שהכוונה לבוקר, ואל תנמק זמינות לפי שעת הפתיחה.`
  );
}
