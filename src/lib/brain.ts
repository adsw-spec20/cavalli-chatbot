/**
 * "מוח הבוט" - מיפוי של כל מה שהבוט יודע, לתצוגה ובקרה בפאנל.
 *
 * הבעיה שזה פותר: הידע של הבוט מפוזר על חמש שכבות (כללי ברזל בקוד, מאגר
 * התשובות החינמיות בקוד, מידע עסקי ב-DB, ידע נלמד ב-DB, ומדיה), ואף אחד לא
 * רואה אותן יחד. לכן סתירות בין שכבות נולדות בשקט ומתגלות רק כשלקוח מקבל
 * תשובה שגויה (נמצא בפועל 15.9: כלל אוסר להזכיר "טאביט" בהקשר פיקדון, ושני
 * מקורות אחרים מורים לבוט בדיוק להפך).
 *
 * המודול קורא בלבד - הוא לא משנה שום דבר ולא שולח כלום למודל.
 */

import { loadBusinessConfig } from "./business-config-store";
import { loadMedia } from "./media-store";
import { buildSystemPrompt } from "./system-prompt";
import { getRepo } from "./db";
import { renderQuickAnswerCatalog } from "./conversation-service";
import { loadOverrides, applyPromptOverrides } from "./brain-store";

export interface BrainItem {
  /** מזהה יציב לניווט ולעריכה עתידית */
  id: string;
  title: string;
  /** התוכן עצמו כפי שהבוט רואה אותו */
  body: string;
  chars: number;
  /** אומדן טוקנים. עברית ~1.43 תווים לטוקן (נמדד על הפרומפט שלנו) */
  tokens: number;
  /** מאיפה זה מגיע, ולכן האם אפשר לערוך היום */
  origin: "code" | "config" | "learned" | "media" | "runtime";
  editable: boolean;
  /** האם הפריט נערך בפאנל (ולכן דורס את ברירת המחדל שבקוד) */
  edited?: boolean;
  /** ברירת המחדל שבקוד - מוצגת לצד העריכה ומאפשרת חזרה */
  defaultText?: string;
  /** דריסה שהטקסט המקורי שלה כבר לא קיים בקוד, ולכן אינה מוחלת */
  stale?: boolean;
  /** לתבניות: מה מפעיל אותן (מוצג לצד העורך) */
  matchNote?: string;
  /** תבנית שנבנית מהמידע העסקי - עריכה תקפיא אותה כטקסט קבוע */
  dynamic?: boolean;
  /** כמה ניסוחים הבוט מגריל ביניהם */
  variantCount?: number;
}

export interface BrainLayer {
  key: string;
  title: string;
  note: string;
  items: BrainItem[];
  tokens: number;
}

export interface BrainConflict {
  severity: "high" | "medium";
  topic: string;
  detail: string;
  where: string[];
}

export interface BrainSnapshot {
  layers: BrainLayer[];
  totalTokens: number;
  /** עלות משוערת של הפרומפט בלבד, להודעה אחת (Sonnet, כתיבה למטמון) */
  estCostPerMessage: number;
  conflicts: BrainConflict[];
  matches?: { layer: string; id: string; title: string; excerpt: string }[];
  editedCount: number;
  staleIds: string[];
  generatedAt: number;
}

/** יחס שנמדד על הפרומפט האמיתי שלנו: 1.43 תווים לטוקן בעברית. */
const CHARS_PER_TOKEN = 1.43;
const tok = (s: string) => Math.round(s.length / CHARS_PER_TOKEN);

/** מפרק את ה-System Prompt לסעיפים לפי כותרות "# ..." וכללים ממוספרים. */
function splitPrompt(prompt: string): BrainItem[] {
  const items: BrainItem[] = [];
  const lines = prompt.split("\n");
  let title = "פתיחה";
  let id = "intro";
  let buf: string[] = [];
  const flush = () => {
    const body = buf.join("\n").trim();
    if (body) items.push({ id, title, body, chars: body.length, tokens: tok(body), origin: "code", editable: true });
    buf = [];
  };
  for (const ln of lines) {
    const h = ln.match(/^#\s+(.+)$/);
    const rule = ln.match(/^(\d+)\.\s+\*\*(.+?)\*\*/);
    if (h) {
      flush();
      title = h[1].trim();
      id = `sec-${items.length + 1}`;
    } else if (rule) {
      flush();
      title = `כלל ${rule[1]}: ${rule[2].trim()}`;
      id = `rule-${rule[1]}`;
    }
    buf.push(ln);
  }
  flush();
  return items;
}

/**
 * גלאי סתירות. לא מודל - בדיקות ממוקדות על נושאים שכבר נשרפנו עליהם.
 * כל בדיקה מתארת נושא, ומחפשת הוראות סותרות בין השכבות.
 */
function findConflicts(prompt: string, configText: string, learnedText: string): BrainConflict[] {
  const out: BrainConflict[] = [];

  // 1. "טאביט" בהקשר פיקדון: הכלל אוסר, מקורות אחרים מורים להפך
  const forbidsTabit = /קרא לזה "?האתר"?, לא "?טאביט"?/.test(prompt);
  const configSaysTabit = /פיקדון[^.]{0,120}טאביט|טאביט[^.]{0,120}פיקדון/.test(configText);
  const learnedSaysTabit = /פיקדון[^.]{0,120}טאביט|טאביט[^.]{0,120}פיקדון/.test(learnedText);
  if (forbidsTabit && (configSaysTabit || learnedSaysTabit)) {
    const where = ["כללי ברזל (אוסר)"];
    if (configSaysTabit) where.push("מידע עסקי (מורה להפך)");
    if (learnedSaysTabit) where.push("ידע נלמד (מורה להפך)");
    out.push({
      severity: "high",
      topic: "המילה \"טאביט\" בהקשר הפיקדון",
      detail:
        "כלל הברזל מורה לקרוא למערכת ההזמנות \"האתר\" ולא \"טאביט\", אבל מקורות ידע אחרים מנסחים דווקא \"קישור טאביט\". הבוט יבחר לפי מה שבולט לו באותו רגע, והניסוח ללקוח לא יהיה עקבי.",
      where,
    });
  }

  // 2. הפיקדון כאילו מתקזז מהחשבון - טענה שגויה שהמודל המציא בעבר
  const creditClaim = /(פיקדון|מקדמה)[^.]{0,80}(מתקזז|מנוכה|יורד מהחשבון|על חשבון הארוחה)/;
  for (const [name, text] of [["מידע עסקי", configText], ["ידע נלמד", learnedText], ["כללי ברזל", prompt]] as const) {
    if (creditClaim.test(text) && !/אסור לומר שהפיקדון/.test(text)) {
      out.push({
        severity: "high",
        topic: "מה קורה לפיקדון כשמגיעים",
        detail: "יש כאן טענה שהפיקדון מתקזז מהחשבון. הפיקדון נגבה רק באי-הגעה או בביטול מתחת ל-24 שעות, ואינו מתקזז.",
        where: [name],
      });
    }
  }

  // 3. מדיניות חיוב חלקית: "רק באי-הגעה" בלי הביטול המאוחר
  const partialPolicy = /מחויב רק ב?(מקרה של )?אי[- ]הגעה/;
  for (const [name, text] of [["מידע עסקי", configText], ["ידע נלמד", learnedText]] as const) {
    if (partialPolicy.test(text)) {
      out.push({
        severity: "medium",
        topic: "מדיניות חיוב הפיקדון",
        detail: "כתוב שהפיקדון מחויב רק באי-הגעה. בפועל גם ביטול פחות מ-24 שעות לפני המועד מחייב, והשמטה הזאת מטעה לקוח שמבטל ברגע האחרון.",
        where: [name],
      });
    }
  }

  // 4. שעות שמופיעות גם בכלל וגם במידע העסקי עם ערכים שונים
  const promptHours = [...prompt.matchAll(/נסגרים ב-(\d{1,2}:\d{2})/g)].map((m) => m[1]);
  const uniq = [...new Set(promptHours)];
  if (uniq.length > 2) {
    out.push({
      severity: "medium",
      topic: "שעות סגירה מרובות בהוראות",
      detail: `בהוראות מופיעות ${uniq.length} שעות סגירה שונות (${uniq.join(", ")}). ודא שכולן נכונות ושאין ניסוח מיושן.`,
      where: ["כללי ברזל"],
    });
  }

  return out;
}

export async function buildBrainSnapshot(query = ""): Promise<BrainSnapshot> {
  const [config, media, qa, overrides] = await Promise.all([
    loadBusinessConfig(),
    loadMedia(),
    getRepo().listLearnedQA("answered").catch(() => []),
    loadOverrides(),
  ]);
  const basePrompt = buildSystemPrompt(config, media);
  // מה שמוצג הוא מה שהבוט באמת מקבל - כולל עריכות שכבר נשמרו
  const { prompt, stale } = applyPromptOverrides(basePrompt, overrides);

  // --- שכבה 1: כללי ברזל והוראות ---
  // הסעיפים נחתכים מברירת המחדל (כדי שעוגן ה-base יישאר יציב), ומי שנערך
  // מוצג עם הנוסח הפעיל ומסומן.
  const defaults = new Map(splitPrompt(basePrompt).map((i) => [i.id, i.body]));
  const ruleItems: BrainItem[] = splitPrompt(basePrompt).map((it) => {
    const ov = overrides.items[it.id];
    if (!ov) return it;
    return {
      ...it,
      body: ov.text,
      chars: ov.text.length,
      tokens: tok(ov.text),
      edited: true,
      defaultText: defaults.get(it.id),
      stale: stale.includes(it.id),
    };
  });

  // --- שכבה 2: מאגר התשובות החינמיות ---
  // הטקסט האמיתי שהלקוח מקבל, מרונדר מאותה פונקציה שמשרתת לקוחות
  const cannedItems: BrainItem[] = renderQuickAnswerCatalog(config, media.length > 0).map((c) => {
    const id = `canned-${c.key}`;
    const ov = overrides.items[id];
    // כל הניסוחים יחד, מופרדים בשורת ~~~ - כך רואים ועורכים את המלאי המלא
    const text = ov?.text ?? c.variants.join("\n~~~\n");
    return {
      id,
      title: c.title,
      body: text,
      chars: text.length,
      tokens: tok(text),
      origin: "code" as const,
      editable: true,
      edited: !!ov,
      defaultText: c.variants.join("\n~~~\n"),
      matchNote: c.patterns,
      dynamic: c.dynamic,
      variantCount: c.variants.length,
    };
  });

  // --- שכבה 3: מידע עסקי (ניתן לעריכה היום) ---
  const cfgItems: BrainItem[] = [
    { id: "cfg-tone", title: "טון הדיבור", body: config.tone, origin: "config" as const },
    { id: "cfg-desc", title: "מי אנחנו", body: config.description, origin: "config" as const },
    { id: "cfg-hours", title: "שעות פעילות", body: config.hours.map((h) => `${h.day}: ${h.hours ?? "סגור"}`).join("\n"), origin: "config" as const },
    { id: "cfg-policies", title: "מדיניות ונהלים", body: (config.policies ?? []).join("\n\n"), origin: "config" as const },
    { id: "cfg-faqs", title: "שאלות נפוצות", body: config.faqs.map((f) => `ש: ${f.question}\nת: ${f.answer}`).join("\n\n"), origin: "config" as const },
    { id: "cfg-forbidden", title: "נושאים אסורים", body: config.forbiddenTopics.join("\n"), origin: "config" as const },
    { id: "cfg-escalate", title: "מתי מעבירים לנציג", body: config.escalateToHumanWhen.join("\n"), origin: "config" as const },
    { id: "cfg-menu", title: "תפריט", body: config.menu.map((c) => `${c.name}: ${c.items.length} פריטים`).join("\n"), origin: "config" as const },
  ].map((x) => ({ ...x, chars: x.body.length, tokens: tok(x.body), editable: true }));

  // --- שכבה 4: ידע נלמד ---
  const learned = (qa as { id: string; question: string; answer?: string | null; status?: string }[])
    .filter((q) => q.answer);
  const learnedItems: BrainItem[] = learned.map((q) => ({
    id: `qa-${q.id}`,
    title: q.question,
    body: q.answer ?? "",
    chars: (q.answer ?? "").length,
    tokens: tok(q.answer ?? ""),
    origin: "learned",
    editable: true,
  }));

  // --- שכבה 5: מדיה ---
  const mediaItems: BrainItem[] = media.map((m) => ({
    id: `media-${m.id}`,
    title: m.label,
    body: `מילות מפתח: ${m.keywords}\nסוג: ${m.type}`,
    chars: m.label.length + m.keywords.length,
    tokens: tok(m.label + m.keywords),
    origin: "media",
    // המדיה מנוהלת בטאב "מדיה" (קבצים, לא טקסט) - עריכה כאן לא היתה עושה כלום
    editable: false,
  }));

  // --- שכבה 6: הקשר דינמי שנוסף בזמן אמת ---
  const runtimeItems: BrainItem[] = [
    { id: "rt-time", title: "השעה בישראל", body: "מוזרק לתוך ההודעה האחרונה בכל פנייה, כדי לא לפסול את מטמון הפרומפט." },
    { id: "rt-memory", title: "זיכרון הלקוח", body: "כרטיס קצר מהשיחות הקודמות של אותו לקוח (אם קיים)." },
    { id: "rt-res", title: "הזמנות פעילות", body: "אם ללקוח יש הזמנה פתוחה, היא מוצגת לבוט." },
    { id: "rt-channel", title: "הערוץ", body: "וואטסאפ / מסנג'ר / אינסטגרם - משפיע על עיצוב הטקסט." },
    { id: "rt-learned", title: "ידע שהצוות הוסיף", body: "בלוק נפרד וממוטמן עם השאלות שנענו בפאנל." },
  ].map((x) => ({ ...x, chars: x.body.length, tokens: 0, origin: "runtime" as const, editable: false }));

  const layers: BrainLayer[] = [
    { key: "rules", title: "כללי ברזל והוראות", note: "הליבה שמכתיבה איך הבוט מתנהג. יושב בקוד.", items: ruleItems },
    { key: "canned", title: "מאגר תשובות חינמיות", note: "שאלות שנענות בלי מודל, ולכן בעלות אפס.", items: cannedItems },
    { key: "config", title: "מידע עסקי", note: "תפריט, שעות, מדיניות. ניתן לעריכה בפאנל.", items: cfgItems },
    { key: "learned", title: "ידע נלמד", note: "שאלות שהצוות ענה עליהן והבוט אימץ. עריכה כאן משנה את התשובה עצמה.", items: learnedItems },
    { key: "media", title: "מדיה", note: "סרטונים ותמונות שהבוט יכול לשלוח. הקבצים מנוהלים בטאב מדיה.", items: mediaItems },
    { key: "runtime", title: "הקשר דינמי", note: "מה שנוסף בזמן אמת לכל שיחה.", items: runtimeItems },
  ].map((l) => ({ ...l, tokens: l.items.reduce((s, i) => s + i.tokens, 0) }));

  const configText = JSON.stringify(config);
  const learnedText = learned.map((q) => `${q.question} ${q.answer}`).join("\n");
  const conflicts = findConflicts(prompt, configText, learnedText);

  // חיפוש רוחבי: איפה בכלל מוזכר מונח מסוים
  let matches: BrainSnapshot["matches"];
  if (query.trim()) {
    const q = query.trim();
    matches = [];
    for (const layer of layers) {
      for (const item of layer.items) {
        const idx = item.body.indexOf(q);
        const inTitle = item.title.includes(q);
        if (idx < 0 && !inTitle) continue;
        const at = idx >= 0 ? idx : 0;
        matches.push({
          layer: layer.title,
          id: item.id,
          title: item.title,
          excerpt: item.body.slice(Math.max(0, at - 70), at + 170).replace(/\n/g, " "),
        });
      }
    }
  }

  const totalTokens = tok(prompt);
  return {
    layers,
    totalTokens,
    // כתיבה למטמון ב-Sonnet: $3.75 למיליון
    estCostPerMessage: Math.round((totalTokens * 3.75) / 1e6 * 1e4) / 1e4,
    conflicts,
    matches,
    editedCount: Object.keys(overrides.items).length,
    staleIds: stale,
    generatedAt: Date.now(),
  };
}
