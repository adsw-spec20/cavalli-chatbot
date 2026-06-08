/**
 * נקודת הכניסה לשכבת הנתונים.
 *
 * מחזיר singleton של ה-Repository. כרגע מימוש מבוסס-קובץ (פיתוח). בפרודקשן
 * נוסיף כאן בחירה ב-PostgresRepository לפי משתנה סביבה (DATABASE_URL), בלי
 * לשנות אף קוד אחר במערכת.
 */

import { FileRepository } from "./file-repo";
import { PostgresRepository } from "./postgres-repo";
import type { Repository } from "./types";

let repo: Repository | null = null;

export function getRepo(): Repository {
  if (!repo) {
    const url = process.env.DATABASE_URL;
    // בפרודקשן (Vercel) מוגדר DATABASE_URL → Postgres. מקומית → אחסון קובץ.
    repo = url ? new PostgresRepository(url) : new FileRepository();
  }
  return repo;
}

export * from "./types";
