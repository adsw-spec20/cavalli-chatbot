/**
 * מאגר המידע העסקי - גרסה הניתנת לעריכה מהפאנל.
 *
 * הקובץ business-config.ts מחזיק את ברירת המחדל (הנתונים המקוריים בקוד).
 * כאן אנחנו מאפשרים לבעל העסק לערוך את המידע מתוך פאנל הניהול: הגרסה הערוכה
 * נשמרת ב-DB (טבלת settings, מפתח "business_config") כ-JSON, והבוט קורא ממנה.
 * אם אין גרסה ערוכה - נופלים בחזרה לברירת המחדל מהקוד.
 */

import { getRepo } from "./db";
import { businessConfig as defaultConfig } from "./business-config";
import type { BusinessConfig } from "./business-config";

const SETTING_KEY = "business_config";

/** טוען את המידע העסקי: הגרסה הערוכה מה-DB, או ברירת המחדל מהקוד. */
export async function loadBusinessConfig(): Promise<BusinessConfig> {
  try {
    const raw = await getRepo().getSetting(SETTING_KEY);
    if (!raw) return defaultConfig;
    const parsed = JSON.parse(raw) as Partial<BusinessConfig>;
    // מיזוג מעל ברירת המחדל כדי שלא יישבר אם חסר שדה בגרסה הערוכה
    return { ...defaultConfig, ...parsed };
  } catch {
    return defaultConfig;
  }
}

/** שומר את המידע העסקי הערוך (מהפאנל). */
export async function saveBusinessConfig(config: BusinessConfig): Promise<void> {
  await getRepo().setSetting(SETTING_KEY, JSON.stringify(config));
}

/** מחזיר את ברירת המחדל מהקוד (לשחזור / "אפס לברירת מחדל" בפאנל). */
export function getDefaultBusinessConfig(): BusinessConfig {
  return defaultConfig;
}

const ARCHIVE_KEY = "events_archive";

/**
 * מעביר אירועים שהתאריך שלהם עבר אל ארכיון נפרד.
 * למה: הקונפיג הפעיל נשאר נקי (וקטן), אבל ההיסטוריה נשמרת כדי שנדע מה היה.
 * נקרא כשפותחים את המידע העסקי בפאנל - תדירות נמוכה, בלי לגעת בנתיב ההודעות.
 * מחזיר כמה אירועים אורכבו (0 = לא נדרש שינוי).
 */
/**
 * מנקה דריסות שעות חריגות שתאריכן עבר (חד-פעמיות מטבען, אין ערך היסטורי).
 * נקרא יחד עם ארכוב האירועים כשפותחים את המידע העסקי בפאנל.
 */
export async function prunePastHoursOverrides(todayISO: string): Promise<number> {
  try {
    const raw = await getRepo().getSetting(SETTING_KEY);
    if (!raw) return 0;
    const config = JSON.parse(raw) as Partial<BusinessConfig>;
    const all = config.hoursOverrides ?? [];
    const keep = all.filter((o) => !o.date || o.date >= todayISO);
    if (keep.length === all.length) return 0;
    config.hoursOverrides = keep;
    await getRepo().setSetting(SETTING_KEY, JSON.stringify(config));
    return all.length - keep.length;
  } catch {
    return 0;
  }
}

export async function archivePastEvents(todayISO: string): Promise<number> {
  try {
    const raw = await getRepo().getSetting(SETTING_KEY);
    if (!raw) return 0; // עוד לא נערך מהפאנל - אין מה לארכב
    const config = JSON.parse(raw) as Partial<BusinessConfig>;
    const events = config.events ?? [];
    const past = events.filter((e) => e.date && e.date < todayISO);
    if (past.length === 0) return 0;

    // הוספה לארכיון (מצטבר), עם הגנה מפני גדילה אינסופית
    let archive: typeof past = [];
    try {
      const rawArchive = await getRepo().getSetting(ARCHIVE_KEY);
      if (rawArchive) archive = JSON.parse(rawArchive);
    } catch {
      archive = [];
    }
    const merged = [...archive, ...past].slice(-500);
    await getRepo().setSetting(ARCHIVE_KEY, JSON.stringify(merged));

    // הקונפיג הפעיל נשאר רק עם אירועים עתידיים / ידניים
    config.events = events.filter((e) => !(e.date && e.date < todayISO));
    await getRepo().setSetting(SETTING_KEY, JSON.stringify(config));
    console.log(`[events] אורכבו ${past.length} אירועים שעברו`);
    return past.length;
  } catch (err) {
    console.error("[events] ארכוב נכשל:", err);
    return 0;
  }
}
