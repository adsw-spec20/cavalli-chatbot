/**
 * שליפת ידע חכמה (retrieval) - הנדסת עלות.
 *
 * במקום לשלוח למודל את כל התפריט הענק בכל הודעה (בזבוז טוקנים = כסף), אנחנו
 * שולפים רק את קטגוריות התפריט הרלוונטיות לשאלת הלקוח. שאלה על יין? נשלח רק
 * יינות. שאלה על חניה? לא נשלח תפריט בכלל. זה חוסך חלק גדול מהעלות בלי לפגוע
 * באיכות, כי המידע הרלוונטי תמיד נשלח, והבוט תמיד יודע אילו קטגוריות קיימות
 * (שמות הקטגוריות נמצאים ב-System Prompt הקבוע).
 *
 * השליפה דטרמיניסטית (התאמת מילות מפתח) - בלי קריאת LLM נוספת, אז היא חינמית.
 */

import type { BusinessConfig, MenuCategory } from "./business-config";

const STOPWORDS = new Set([
  "של", "עם", "מה", "יש", "לי", "אני", "הוא", "היא", "את", "על", "או", "גם",
  "כמה", "עולה", "מחיר", "ולא", "אבל", "בלי", "כל", "זה", "אם", "כן",
]);

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[׳ʼ'’"״`]/g, "")
    .replace(/[^֐-׿a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** מרחק עריכה (Levenshtein) - לזיהוי שגיאות כתיב */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 2) return 99; // קיצור דרך: רחוק מדי
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

/** האם מילת המשתמש תואמת לטוקן, כולל סובלנות לשגיאות כתיב */
function fuzzyMatch(userWord: string, token: string): boolean {
  if (token.length < 4 || userWord.length < 4) return false;
  const threshold = Math.max(token.length, userWord.length) >= 6 ? 2 : 1;
  return editDistance(userWord, token) <= threshold;
}

// סיווג קטגוריה לפי שמה
function isAlcohol(c: MenuCategory): boolean {
  return /וודקה|וויסקי|ויסקי|יין|קוקטייל|בירה|טקילה|רום|ערק|אלכוהול|גין/.test(
    c.name
  );
}
function isHotDrink(c: MenuCategory): boolean {
  return c.name.includes("חמה");
}
function isColdDrink(c: MenuCategory): boolean {
  return c.name.includes("קלה");
}
function isFood(c: MenuCategory): boolean {
  return !isAlcohol(c) && !isHotDrink(c) && !isColdDrink(c);
}

/**
 * מחזיר את הקטגוריות הרלוונטיות לטקסט (בד"כ ההודעות האחרונות בשיחה).
 */
export function selectRelevantCategories(
  config: BusinessConfig,
  text: string
): MenuCategory[] {
  const norm = normalize(text);
  const cats = config.menu;
  const picked = new Set<MenuCategory>();

  const has = (...kw: string[]) =>
    kw.some((k) => norm.includes(normalize(k)));

  // 1) התאמה לפי שמות מנות/קטגוריות (תופס מנות ספציפיות, למשל "קרואסון", "בוראטה")
  //    כולל סובלנות לשגיאות כתיב: "קורסון" → "קרואסון".
  const userWords = norm.split(" ").filter((w) => w.length >= 3);
  for (const c of cats) {
    const tokens = [c.name, ...c.items.map((i) => i.name)]
      .flatMap((n) => normalize(n).split(" "))
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
    const exact = tokens.some((t) => norm.includes(t));
    const fuzzy =
      !exact &&
      tokens.some((t) => userWords.some((w) => fuzzyMatch(w, t)));
    if (exact || fuzzy) picked.add(c);
  }

  // 2) כללים רחבים לפי נושא
  const addWhere = (pred: (c: MenuCategory) => boolean) =>
    cats.filter(pred).forEach((c) => picked.add(c));

  // כוונת "המלצה/לאכול" טוענת פירוט אוכל (כדי שהבוט יוכל להמליץ). שאלת "מה יש
  // בתפריט?" הכללית לא טוענת הכל - הבוט פשוט ימנה קטגוריות מהליבה ויציע להעמיק.
  if (has("ממליצים", "המלצה", "להמליץ", "רעב", "בא לי", "לאכול", "אוכל", "ארוחה"))
    addWhere(isFood);
  if (has("טבעוני", "צמחוני", "גלוטן", "אלרגי", "אלרגיה", "טבעונית", "צמחונית"))
    addWhere(isFood);
  if (has("ילדים", "ילד", "תינוק", "משפחה")) addWhere(isFood);
  if (has("שתייה", "לשתות", "שתיה", "משקה", "משקאות")) {
    addWhere(isHotDrink);
    addWhere(isColdDrink);
  }
  if (has("קפה", "אספרסו", "קפוצ", "הפוך", "תה", "שוקו", "מאצ", "מקיאטו", "קורטדו"))
    addWhere(isHotDrink);
  if (has("אייס", "מיץ", "קולה", "ספרייט", "סודה", "לימונענע", "פאנטה"))
    addWhere(isColdDrink);
  if (has("אלכוהול", "בר", "חריף", "שוט", "צייסר", "צ'ייסר", "אלכוהולי"))
    addWhere(isAlcohol);
  if (has("יין", "יינות")) addWhere((c) => c.name.includes("יינות"));
  if (has("בירה")) addWhere((c) => c.name.includes("בירה"));
  if (has("קוקטייל", "קוקטיילים")) addWhere((c) => c.name.includes("קוקטייל"));
  if (has("וויסקי", "ויסקי", "מקאלן", "שיבאס", "לייבל", "גלנפידיש"))
    addWhere((c) => c.name.includes("וויסקי"));
  if (has("וודקה", "בלוגה", "גרייגוס")) addWhere((c) => c.name.includes("וודקה"));
  if (has("דג", "דגים", "סלמון", "דניס", "לברק", "מהים"))
    addWhere((c) => c.name.includes("מהים"));
  if (has("פיצה", "פיצות")) addWhere((c) => c.name.includes("פיצות"));
  if (has("פסטה", "פסטות", "ניוקי", "רביולי")) addWhere((c) => c.name.includes("פסטות"));
  if (has("סלט", "סלטים")) addWhere((c) => c.name.includes("סלטים"));
  if (has("קינוח", "קינוחים", "מתוק", "עוגה", "גלידה")) addWhere((c) => c.name.includes("קינוחים"));
  if (has("בוקר")) addWhere((c) => c.name.includes("בוקר"));

  // 3) אם נבחרו כמעט הכל, פשוט נשלח הכל (אין חיסכון, נמנע מחלקיות מוזרה)
  const result = cats.filter((c) => picked.has(c));
  if (result.length >= cats.length - 2) return cats;
  return result;
}

/** מעבד רשימת קטגוריות לטקסט שנשלח למודל */
export function renderMenuCategories(categories: MenuCategory[]): string {
  return categories
    .map((cat) => {
      const note = cat.note ? ` (${cat.note})` : "";
      // פורמט דחוס בכוונה: אותו מידע בדיוק (שם, מחיר, תיאור, תגיות, אזל),
      // בלי תווי עיצוב מיותרים. התפריט נשלח בכל בקשה, אז כל תו חוסך עלות.
      const items = cat.items
        .map((item) => {
          const desc = item.description ? ` - ${item.description}` : "";
          const tags =
            item.tags && item.tags.length ? ` [${item.tags.join(",")}]` : "";
          const allergens =
            item.allergens && item.allergens.length
              ? ` [אלרגנים: ${item.allergens.join(",")}]`
              : "";
          const soldOut = item.available === false ? " (אזל - לא זמין)" : "";
          return `${item.name} ${item.price}${desc}${tags}${allergens}${soldOut}`;
        })
        .join("\n");
      return `## ${cat.name}${note}\n${items}`;
    })
    .join("\n");
}

/** שמות כל הקטגוריות (נכנס ל-System Prompt הקבוע כדי שהבוט תמיד יודע מה קיים) */
export function getCategoryNames(config: BusinessConfig): string[] {
  return config.menu.map((c) => c.name);
}

/**
 * בונה את "בלוק התפריט" הדינמי שנשלח בנפרד מה-System Prompt הקבוע.
 * @param recentText טקסט ההודעות האחרונות בשיחה (כדי לתפוס גם שאלות המשך)
 */
export function buildMenuContext(
  config: BusinessConfig,
  recentText: string
): string {
  const cats = selectRelevantCategories(config, recentText);
  if (!cats.length) return "";
  return "# פירוט תפריט (הקטגוריות הרלוונטיות לשאלה)\n" + renderMenuCategories(cats);
}
