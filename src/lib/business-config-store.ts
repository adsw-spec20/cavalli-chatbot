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
