/**
 * פורמט כרטיס הזיכרון של הלקוח - מודול טהור (בלי תלויות שרת).
 *
 * מיובא גם בשרת (יצירת/הזרקת הזיכרון) וגם בלקוח (תצוגת כרטיס הלקוח בפאנל),
 * לכן אסור לו לייבא getRepo/Anthropic וכו'.
 *
 * הזיכרון נשמר כ-JSON מובנה: { warnings: [...], preferences: "..." }.
 * זיכרונות ישנים (טקסט חופשי, מלפני המבנה) נתמכים לאחור ומוצגים כ-`general`.
 */

export interface StructuredMemory {
  /** אזהרות/רגישויות שכדאי שהצוות ישים לב אליהן (פיקדון, אלרגיה, תלונה...) */
  warnings: string[];
  /** העדפות והרגלים קבועים (מנה אהובה, ישיבה בחוץ, בא עם ילדים...) */
  preferences: string;
  /** תאימות לאחור: זיכרון ישן בטקסט חופשי שנשמר לפני המבנה */
  general?: string;
}

/** מפרק את שדה הזיכרון הגולמי למבנה. תומך גם ב-JSON חדש וגם בטקסט חופשי ישן. */
export function parseMemory(raw?: string | null): StructuredMemory {
  const s = raw?.trim();
  if (!s) return { warnings: [], preferences: "" };

  // מבנה חדש: JSON
  if (s.startsWith("{")) {
    try {
      const o = JSON.parse(s) as { warnings?: unknown; preferences?: unknown };
      if (o && typeof o === "object") {
        const warnings = Array.isArray(o.warnings)
          ? o.warnings.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim())
          : [];
        const preferences = typeof o.preferences === "string" ? o.preferences.trim() : "";
        return { warnings, preferences };
      }
    } catch {
      /* לא JSON תקין - נופלים לטקסט חופשי */
    }
  }

  // מבנה ישן: טקסט חופשי (מנקים דליפת Markdown של כוכביות מזיכרונות ישנים)
  return { warnings: [], preferences: "", general: s.replace(/\*\*/g, "").trim() };
}

/** האם הזיכרון ריק לחלוטין (אין מה להציג/להזריק)? */
export function isMemoryEmpty(m: StructuredMemory): boolean {
  return m.warnings.length === 0 && !m.preferences.trim() && !m.general?.trim();
}

/** ממיר מבנה חזרה למחרוזת JSON לשמירה. מחזיר "" אם אין תוכן. */
export function serializeMemory(m: { warnings: string[]; preferences: string }): string {
  const warnings = m.warnings.map((w) => w.trim()).filter(Boolean);
  const preferences = m.preferences.trim();
  if (warnings.length === 0 && !preferences) return "";
  return JSON.stringify({ warnings, preferences });
}

/** מנסח את הזיכרון כטקסט זורם להזרקה ל-System Prompt של הבוט. */
export function formatMemoryForPrompt(raw?: string | null): string {
  const m = parseMemory(raw);
  if (isMemoryEmpty(m)) return "";
  if (m.general) return m.general;
  const parts: string[] = [];
  if (m.warnings.length) parts.push("לשים לב: " + m.warnings.join("; "));
  if (m.preferences) parts.push("העדפות: " + m.preferences);
  return parts.join(". ");
}
