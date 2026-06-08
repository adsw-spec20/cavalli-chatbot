/**
 * נקודת הכניסה לשכבת הנתונים.
 *
 * מחזיר singleton של ה-Repository. כרגע מימוש מבוסס-קובץ (פיתוח). בפרודקשן
 * נוסיף כאן בחירה ב-PostgresRepository לפי משתנה סביבה (DATABASE_URL), בלי
 * לשנות אף קוד אחר במערכת.
 */

import { FileRepository } from "./file-repo";
import type { Repository } from "./types";

let repo: Repository | null = null;

export function getRepo(): Repository {
  if (!repo) {
    // עתידי:
    // if (process.env.DATABASE_URL) repo = new PostgresRepository(process.env.DATABASE_URL);
    // else repo = new FileRepository();
    repo = new FileRepository();
  }
  return repo;
}

export * from "./types";
