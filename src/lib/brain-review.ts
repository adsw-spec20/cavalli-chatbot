/**
 * "בירור המוח" - תהליך מונחה לסקירה והעשרה של כל מה שהבוט יודע.
 *
 * הבעיה שזה פותר (בקשת בעל העסק 18.9.2026): המוח גדל לאורך חודשים לכ-40 אלף
 * טוקנים, כל תקלה הפכה לכלל, ואי אפשר לעקוב. מסך "מוח הבוט" *מציג* הכל, אבל
 * לדפדף בו זה לא תהליך: אין סדר, אין התקדמות ואין סוף. שאלון סטטי נכשל מסיבה
 * אחרת: הוא נכתב פעם אחת, לא שיקף את המוח האמיתי, והתשובות לא חזרו לבוט.
 *
 * הפתרון: **תור החלטות**. המוח נחתך ליחידות קטנות ("אטומים"), כל אטום מקבל
 * שאלה בעברית פשוטה, והתשובה **נכנסת לבוט מיד** דרך שכבת הדריסות הקיימת.
 * מאורגן לפי נושאים, כדי שאפשר לשבת ולסגור תחום שלם בישיבה אחת.
 *
 * מה נשאר דטרמיניסטי כאן: החיתוך, שיוך הנושא, והכתיבה חזרה. מה שמודל עושה:
 * רק ניסוח השאלה בשפה אנושית (עם נפילה לתבנית אם אין מודל/נכשל).
 */

import { getRepo } from "./db";
import { loadBusinessConfig } from "./business-config-store";
import { loadMedia } from "./media-store";
import { buildSystemPrompt } from "./system-prompt";
import { loadOverrides, applyPromptOverrides, setAnchorOverride, clearOverride } from "./brain-store";

const QUESTIONS_KEY = "brain_review_questions";
const STATE_KEY = "brain_review_state";

/** אותו יחס שמשמש את מסך "מוח הבוט" (נמדד על הפרומפט שלנו) */
const CHARS_PER_TOKEN = 1.43;
const tok = (s: string) => Math.round(s.length / CHARS_PER_TOKEN);

// ===== נושאים =====

export interface TopicDef {
  key: string;
  title: string;
  icon: string;
  /** מילות מפתח לשיוך אטומים */
  match: RegExp;
}

/** סדר התצוגה הוא גם סדר העדיפות המוצע (הנפוץ והמשפיע קודם) */
export const TOPICS: TopicDef[] = [
  { key: "reservations", title: "הזמנות מקום", icon: "📅", match: /הזמנ|לשריין|שולחן|מקום פנוי|סועדים|ברק|קבוצ/ },
  { key: "deposit", title: "פיקדון וביטול", icon: "💳", match: /פיקדון|ביטול|לבטל|אי-הגעה|החזר|24 שעות/ },
  { key: "menu", title: "תפריט ומנות", icon: "🍽️", match: /תפריט|מנה|מנות|מחיר|עולה|קינוח|פיצה|פסטה|שתי[יה]|קוקטייל|יין/ },
  { key: "diet", title: "אלרגנים ותזונה", icon: "⚠️", match: /אלרג|גלוטן|טבעוני|צמחוני|לקטוז|רגישות|אלרגנים|כשר/ },
  { key: "hours", title: "שעות וחגים", icon: "🕐", match: /שעות|פתוח|סגור|חג|מועד|שבת|ערב חג|פתיחה|סגירה/ },
  { key: "parking", title: "חניה ושער", icon: "🅿️", match: /חני[יה]|חניון|שער החני|לפתוח את השער|palgate|פלגייט/ },
  { key: "location", title: "מיקום והגעה", icon: "📍", match: /כתובת|מיקום|להגיע|waze|וייז|ניווט|המלאכה/ },
  { key: "groups", title: "אירועים וקבוצות", icon: "🎉", match: /אירוע|קייטרינג|סגירת המקום|יום הולדת|חינה|קבוצה גדולה/ },
  { key: "kids", title: "ילדים ומשפחות", icon: "👶", match: /ילד|תינוק|משפח|גינ[הת]|כיסא/ },
  { key: "payment", title: "תשלום וחשבון", icon: "🧾", match: /תשלום|חשבון|אשראי|מזומן|ביט|טיפ|שירות/ },
  { key: "takeaway", title: "טייק אווי ומשלוחים", icon: "🥡", match: /טייק אווי|איסוף עצמי|משלוח|to-?go/ },
  { key: "escalation", title: "הסלמה ונציג", icon: "🙋", match: /נציג|הסלמ|escalate|תלונה|כעס|מאוכזב/ },
  { key: "tone", title: "טון ושפה", icon: "💬", match: /טון|ניסוח|שפה|אימוג|סמיילי|אנגלית|ערבית|רוסית|קצר|חם/ },
  { key: "media", title: "מדיה ותמונות", icon: "🖼️", match: /תמונ|סרטון|מדיה|וידאו|send_media/ },
  { key: "accessibility", title: "נגישות ונוחות", icon: "♿", match: /נגיש|כיסא גלגלים|שירותים|מעלית|רעש|עישון|חיות|כלב/ },
  { key: "identity", title: "זהות הבוט וגבולות", icon: "🤖", match: /עוזר דיגיטלי|גילוי|AI|אסור לך|נושאים אסורים|לא קשור/ },
];

const FALLBACK_TOPIC = { key: "general", title: "כללי", icon: "📋" };

export function topicTitle(key: string): { title: string; icon: string } {
  const t = TOPICS.find((x) => x.key === key);
  return t ? { title: t.title, icon: t.icon } : FALLBACK_TOPIC;
}

/**
 * הנושא נקבע לפי **מי שמופיע הכי הרבה**, ולא לפי ההתאמה הראשונה: אזכור אגבי
 * של מילה אחת לא אמור לגרור סעיף שלם לנושא הלא נכון.
 */
function assignTopic(text: string): string {
  let best = FALLBACK_TOPIC.key;
  let bestScore = 0;
  for (const t of TOPICS) {
    const hits = text.match(new RegExp(t.match.source, "g"))?.length ?? 0;
    if (hits > bestScore) {
      bestScore = hits;
      best = t.key;
    }
  }
  return best;
}

/**
 * פיגומים מבניים של הפרומפט (כותרות שלבים, שורות טבלה, כותרות משנה) אינם
 * החלטה עסקית - אין לבעל העסק מה לענות עליהם, והם רק מציפים את התור.
 */
function isStructural(text: string): boolean {
  const t = text.trim();
  if (/^\s*\|/.test(t)) return true; // שורת טבלה
  if (/^\*{0,2}▸/.test(t)) return true; // כותרת שלב
  if (/^#{2,}\s/.test(t) && t.length < 120) return true; // כותרת משנה קצרה
  if (/^\*\*[^*]{0,60}\*\*:?$/.test(t)) return true; // שורה שכולה כותרת מודגשת
  return false;
}

// ===== אטומים =====

/**
 * מזהה אטום נגזר מ**תוכן** הסעיף ולא ממיקומו. קריטי: אילו המזהה היה מספר סידורי,
 * מחיקת סעיף אחד הייתה מזיזה את כל מי שאחריו וכל התשובות היו נדבקות לסעיף הלא נכון.
 */
function atomId(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `a${(h >>> 0).toString(36)}`;
}

export interface ReviewAtom {
  /** מזהה יציב שנגזר מהתוכן */
  id: string;
  layer: "rule" | "canned" | "qa";
  /** מזהה הפריט שאותו דורסים כדי לשנות את האטום */
  parentId: string;
  parentTitle: string;
  /** הטקסט המדויק - משמש כעוגן לדריסה, ולכן חייב להישאר זהה לתו */
  text: string;
  tokens: number;
  topic: string;
  /** תאריך שמוזכר בטקסט ("קרה בפועל 14.9") - הקשר ליושן הכלל */
  bornAt?: string;
}

const DATE_IN_TEXT = /(\d{1,2}\.\d{1,2}(?:\.\d{2,4})?)/;

/** אטום גדול מזה כבר לא ניתן להחלטה במבט אחד, ולכן נחתך שוב */
const MAX_ATOM_TOKENS = 380;

/**
 * חותך גוש טקסט ליחידות החלטה: תבליט הוא יחידה, ושורה ריקה מפרידה בין פסקאות.
 * גוש שעדיין ארוך מדי נחתך לפי תבליטי משנה, ואם צריך לפי משפטים - תמיד
 * ברצף אחד, כדי שהטקסט יישאר תת-מחרוזת מדויקת של הפרומפט (עוגן הדריסה).
 */
function splitBlocks(body: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  const push = () => {
    if (cur.join("\n").trim()) out.push(cur.join("\n"));
    cur = [];
  };
  for (const ln of body.split("\n")) {
    if (/^\s*[-•]\s/.test(ln) || /^\s*##\s/.test(ln)) {
      push();
      cur.push(ln);
    } else if (!ln.trim()) {
      push();
    } else {
      cur.push(ln);
    }
  }
  push();

  // חיתוך שני לגושים שנשארו ארוכים מדי
  const final: string[] = [];
  for (const block of out) {
    if (tok(block) <= MAX_ATOM_TOKENS) {
      final.push(block);
      continue;
    }
    const lines = block.split("\n");
    if (lines.length > 1) {
      let chunk: string[] = [];
      for (const ln of lines) {
        if (chunk.length && tok(chunk.join("\n") + ln) > MAX_ATOM_TOKENS) {
          final.push(chunk.join("\n"));
          chunk = [];
        }
        chunk.push(ln);
      }
      if (chunk.length) final.push(chunk.join("\n"));
      continue;
    }
    // שורה אחת ארוכה מאוד: חיתוך לפי משפטים, ברצף
    let acc = "";
    for (const part of block.split(/(?<=[.!?])\s+/)) {
      const next = acc ? `${acc} ${part}` : part;
      if (acc && tok(next) > MAX_ATOM_TOKENS) {
        final.push(acc);
        acc = part;
      } else acc = next;
    }
    if (acc) final.push(acc);
  }
  return final;
}

/**
 * חותך את הפרומפט לאטומים - יחידות שאפשר להחליט עליהן.
 * כלל שלם ("כלל 14") גדול מכדי להחליט עליו, ולכן הוא לא יחידה.
 */
export function atomizeprompt(prompt: string): ReviewAtom[] {
  const atoms: ReviewAtom[] = [];
  const lines = prompt.split("\n");
  let parentId = "intro";
  let parentTitle = "פתיחה";
  let buf: string[] = [];
  let seq = 0;

  const flush = () => {
    const body = buf.join("\n");
    buf = [];
    if (!body.trim()) return;
    for (const text of splitBlocks(body)) {
      const trimmed = text.trim();
      if (trimmed.length < 60 || isStructural(trimmed)) continue;
      // עוגן הדריסה חייב להיות חד-משמעי: טקסט שמופיע פעמיים בפרומפט לא ניתן
      // להחלפה בטוחה, ולכן לא נכנס לתור.
      if (prompt.split(text).length - 1 !== 1) continue;
      atoms.push({
        id: atomId(trimmed),
        layer: "rule",
        parentId,
        parentTitle,
        text,
        tokens: tok(text),
        topic: assignTopic(text),
        bornAt: trimmed.match(DATE_IN_TEXT)?.[1],
      });
    }
  };

  for (const ln of lines) {
    const head = ln.match(/^#\s+(.+)$/);
    const rule = ln.match(/^(\d+)\.\s+\*\*(.+?)\*\*/);
    if (head) {
      flush();
      parentTitle = head[1].trim();
      parentId = `sec-${++seq}`;
    } else if (rule) {
      flush();
      parentTitle = `כלל ${rule[1]}: ${rule[2].trim()}`;
      parentId = `rule-${rule[1]}`;
    } else {
      buf.push(ln);
    }
  }
  flush();
  return atoms;
}

// ===== שאלות =====

export type QuestionKind = "review" | "enrich";
export type AnswerStatus = "kept" | "changed" | "deleted" | "answered" | "irrelevant" | "unsure" | "skipped";

export interface ReviewQuestion {
  id: string;
  kind: QuestionKind;
  topic: string;
  /** השאלה בעברית פשוטה */
  question: string;
  /** מה זה עושה היום, במשפט */
  summary: string;
  /** הטקסט הנוכחי במוח (לסקירה) */
  text?: string;
  tokens?: number;
  /** שורת ראיות - רק כשיש נתון אמיתי */
  evidence?: string;
  parentId?: string;
  /** הנחיה טכנית שאין לבעל העסק מה להחליט עליה - לא מוצגת ולא נספרת */
  hidden?: boolean;
  /**
   * כשזה נוסח שנוצר מעריכה: המזהה והטקסט של הסעיף **המקורי** בפרומפט.
   * קריטי לעריכה חוזרת - הדריסות מוחלות על הפרומפט הנקי, ולכן עריכה של נוסח
   * שכבר נערך חייבת לעדכן את אותה דריסה ולא לשרשר דריסה שנייה מעליה (שרשור
   * כזה תלוי בסדר ההחלה, ומתפרק ברגע שהסדר משתנה).
   */
  originId?: string;
  originText?: string;
}

export interface ReviewAnswer {
  status: AnswerStatus;
  answer?: string;
  at: number;
  /** באטום שנערך: המזהה של הנוסח החדש, כדי שביטול ינקה גם אותו */
  newId?: string;
}

/**
 * טקסט שכבר נערך בבירור הופך לחלק מדריסה. אחרי עריכה הפרומפט נחתך מחדש,
 * והשאריות של אותו נוסח עלולות לחזור כ"שאלות חדשות" - לכן כל אטום שנמצא
 * **בתוך** נוסח שכבר נערך נחשב מוכרע.
 */
function decidedByOverride(overrideTexts: string[], atomText: string): boolean {
  const t = atomText.trim();
  return overrideTexts.some((o) => o.includes(t));
}

type QuestionStore = Record<string, ReviewQuestion>;
type StateStore = Record<string, ReviewAnswer>;

async function loadJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await getRepo().getSetting(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export const loadQuestions = () => loadJson<QuestionStore>(QUESTIONS_KEY, {});
export const loadState = () => loadJson<StateStore>(STATE_KEY, {});

async function saveQuestions(q: QuestionStore) {
  await getRepo().setSetting(QUESTIONS_KEY, JSON.stringify(q));
}
async function saveState(s: StateStore) {
  await getRepo().setSetting(STATE_KEY, JSON.stringify(s));
}

/** הפרומפט הפעיל (כולל דריסות) - זה מה שהבוט באמת מקבל */
async function activePrompt(): Promise<string> {
  const [config, media, overrides] = await Promise.all([loadBusinessConfig(), loadMedia(), loadOverrides()]);
  const base = buildSystemPrompt(config, media);
  return applyPromptOverrides(base, overrides).prompt;
}

export interface TopicSummary {
  key: string;
  title: string;
  icon: string;
  total: number;
  done: number;
  tokens: number;
}

export interface ReviewOverview {
  topics: TopicSummary[];
  totalQuestions: number;
  totalDone: number;
  promptTokens: number;
  /** כמה טוקנים כבר נחסכו בזכות הבירור */
  tokensSaved: number;
  /** כמה שאלות כבר נוסחו (ולכן נטענות מיד) מתוך כמה - להתקדמות ההכנה */
  phrased: number;
  totalAtoms: number;
}

/** כמה טוקנים הוסרו עד כה (סכום האטומים שנמחקו) */
async function computeSaved(state: StateStore, questions: QuestionStore): Promise<number> {
  let saved = 0;
  for (const [id, ans] of Object.entries(state)) {
    if (ans.status !== "deleted") continue;
    const q = questions[id];
    // בסעיף שנערך ואז נמחק, החיסכון נמדד מול הסעיף **המקורי** שיצא מהפרומפט
    saved += q ? (q.originText ? tok(q.originText) : (q.tokens ?? 0)) : 0;
  }
  return saved;
}

/**
 * תמונת מצב למסך הראשי: נושאים, התקדמות וטוקנים.
 * האטומים נחתכים בכל קריאה מהפרומפט **החי**, כך שהתור לעולם לא מתיישן.
 */
export async function getOverview(): Promise<ReviewOverview> {
  const [prompt, state, questions, openQa, ov] = await Promise.all([
    activePrompt(),
    loadState(),
    loadQuestions(),
    getRepo().listLearnedQA("open").catch(() => []),
    loadOverrides(),
  ]);
  const atoms = atomizeprompt(prompt);
  const edited = Object.values(ov.items).map((o) => o.text).filter(Boolean);

  const byTopic = new Map<string, { total: number; done: number; tokens: number }>();
  const bump = (topic: string, done: boolean, tokens: number) => {
    const cur = byTopic.get(topic) ?? { total: 0, done: 0, tokens: 0 };
    cur.total++;
    if (done) cur.done++;
    cur.tokens += tokens;
    byTopic.set(topic, cur);
  };

  // הנחיות טכניות (שכבר סווגו כך בניסוח) אינן שאלות ואינן נספרות
  for (const a of atoms) {
    if (questions[a.id]?.hidden) continue;
    bump(a.topic, !!state[a.id] || decidedByOverride(edited, a.text), a.tokens);
  }
  // סעיף שנמחק יצא מהפרומפט, ולכן גם מהחיתוך. בלי לספור אותו כאן המחיקה
  // הייתה מקטינה את המכנה במקום לקדם את הסרגל - עבודה שנעשתה ולא נראתה.
  // (עריכה לא נספרת כאן: הנוסח החדש הוא אטום קיים שכבר נספר למעלה.)
  const present = new Set(atoms.map((a) => a.id));
  for (const [id, ans] of Object.entries(state)) {
    if (ans.status !== "deleted" || present.has(id)) continue;
    const q = questions[id];
    if (q && !q.hidden) bump(q.topic, true, 0);
  }
  // שאלות העשרה: פערי ידע אמיתיים שהצטברו
  for (const q of openQa) bump(assignTopic(q.question), !!state[`gap-${q.id}`], 0);

  // כמה מהאטומים כבר מנוסחים - מה שמנוסח נטען מיד, והשאר דורש קריאה למודל
  const phrased = atoms.filter((a) => isPhrased(questions, a)).length;

  const topics: TopicSummary[] = [...byTopic.entries()]
    .map(([key, v]) => ({ key, ...topicTitle(key), ...v }))
    .sort((a, b) => {
      const ia = TOPICS.findIndex((t) => t.key === a.key);
      const ib = TOPICS.findIndex((t) => t.key === b.key);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

  return {
    topics,
    totalQuestions: topics.reduce((s, t) => s + t.total, 0),
    totalDone: topics.reduce((s, t) => s + t.done, 0),
    promptTokens: tok(prompt),
    tokensSaved: await computeSaved(state, questions),
    phrased,
    totalAtoms: atoms.length,
  };
}

/** אטום נחשב מנוסח כשיש לו שאלה שמורה על הטקסט הנוכחי שלו בדיוק */
function isPhrased(questions: QuestionStore, a: ReviewAtom): boolean {
  const q = questions[a.id];
  return !!q && q.text === a.text.trim();
}

/** תבנית נפילה כשאין ניסוח מהמודל - תמיד יש שאלה, גם בלי AI */
function fallbackQuestion(a: ReviewAtom): ReviewQuestion {
  return {
    id: a.id,
    kind: "review",
    topic: a.topic,
    question: "ההנחיה הזאת עדיין נכונה ורלוונטית?",
    summary: `מתוך ${a.parentTitle}`,
    text: a.text.trim(),
    tokens: a.tokens,
    parentId: a.parentId,
    evidence: a.bornAt ? `מוזכר בטקסט תאריך ${a.bornAt}` : undefined,
  };
}

/**
 * מנסח שאלות לאטומים של נושא אחד (בקבוצות, זול ומהיר). נכשל = תבנית.
 * מנוסח בגוף שני אל בעל העסק, בלי ז'רגון טכני.
 */
async function phraseQuestions(
  atoms: ReviewAtom[]
): Promise<Map<string, { question: string; summary: string; hidden?: boolean }>> {
  const out = new Map<string, { question: string; summary: string; hidden?: boolean }>();
  if (!process.env.ANTHROPIC_API_KEY || !atoms.length) return out;
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 45_000 });
  const model = process.env.BRAIN_REVIEW_MODEL ?? "claude-haiku-4-5-20251001";

  // 8 סעיפים לקריאה: מספיק גדול כדי לא לשלם על ההקשר שוב ושוב, מספיק קטן כדי
  // שההמתנה תהיה קצרה (זמן התשובה נגזר בעיקר מאורך הפלט).
  const BATCH = 8;
  const batches: ReviewAtom[][] = [];
  for (let i = 0; i < atoms.length; i += BATCH) batches.push(atoms.slice(i, i + BATCH));

  await pool(batches, 6, async (batch) => {
    const list = batch
      .map((a, i) => `[${i + 1}] (מתוך "${a.parentTitle}")\n${a.text.trim().slice(0, 900)}`)
      .join("\n\n");
    try {
      const resp = await client.messages.create({
        model,
        max_tokens: 2000,
        system:
          "בעל מסעדה עובר על ההנחיות שהצטברו לצ'אטבוט שלו ומחליט מה להשאיר, מה לתקן ומה למחוק. " +
          "לכל הנחיה שאני נותן לך, החזר:\n" +
          "• summary - משפט אחד בעברית פשוטה: מה ההנחיה הזאת גורמת לבוט לעשות מול לקוח. בלי ציטוט ובלי ז'רגון טכני.\n" +
          "• question - שאלה אחת קצרה בגוף שני שמאפשרת לו להחליט. השאלה חייבת להיות על **המציאות בעסק** " +
          "(\"זה עדיין המצב?\", \"עדיין רוצה שהוא יגיד את זה ככה?\", \"המספר הזה נכון?\") ולא על מבנה טכני.\n" +
          "• owner_decision - false אם זו הנחיה טכנית פנימית לבוט שלבעל העסק אין עליה שום דעת " +
          "(סדר שלבים, מבנה תשובה, הוראות עיצוב), true אם יש כאן עובדה, מדיניות, ניסוח ללקוח או החלטה עסקית.\n" +
          'החזר JSON בלבד: {"items":[{"n":1,"summary":"...","question":"...","owner_decision":true}]}',
        messages: [{ role: "user", content: list }],
      });
      const txt = resp.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
      const json = txt.slice(txt.indexOf("{"), txt.lastIndexOf("}") + 1);
      const parsed = JSON.parse(json) as {
        items?: { n: number; summary?: string; question?: string; owner_decision?: boolean }[];
      };
      for (const it of parsed.items ?? []) {
        const atom = batch[it.n - 1];
        if (atom && it.question)
          out.set(atom.id, {
            question: it.question,
            summary: it.summary ?? "",
            hidden: it.owner_decision === false,
          });
      }
    } catch {
      /* נופלים לתבנית */
    }
  });
  return out;
}

/**
 * מנסח מראש את כל מה שעוד לא נוסח, בכל הנושאים.
 *
 * למה: הניסוח הוא הדבר היחיד כאן שדורש מודל, והוא נעשה בפתיחה הראשונה של כל
 * נושא - מה שהפך את הלחיצה על נושא להמתנה של עשרות שניות. עכשיו זה רץ ברקע
 * ברגע שהמסך נפתח, וכשבעל העסק בוחר נושא השאלות כבר מוכנות ונטענות מיד.
 * מנוסח נשמר לתמיד, ולכן זה קורה פעם אחת לכל סעיף (ושוב רק אם הטקסט שונה).
 */
let prewarming = false;

export async function prewarmQuestions(): Promise<{ phrased: number; total: number }> {
  const [prompt, stored] = await Promise.all([activePrompt(), loadQuestions()]);
  const atoms = atomizeprompt(prompt);
  const missing = atoms.filter((a) => !isPhrased(stored, a));
  if (!missing.length || prewarming) return { phrased: atoms.length - missing.length, total: atoms.length };

  prewarming = true;
  try {
    // שומרים קבוצה-קבוצה ולא בסוף: לפונקציה על Vercel יש תקרת זמן, ושמירה
    // אחת בסוף הייתה מאבדת את כל העבודה אם הריצה נקטעת. ככה הריצה הבאה
    // ממשיכה בדיוק מאיפה שנעצרנו.
    const GROUP = 40;
    for (let i = 0; i < missing.length; i += GROUP) {
      const group = missing.slice(i, i + GROUP);
      const phrased = await phraseQuestions(group);
      // נטען מחדש לפני כל שמירה: ייתכן שבינתיים נשמרה תשובה, ואין לדרוס אותה
      const fresh = await loadQuestions();
      for (const a of group) {
        const p = phrased.get(a.id);
        const base = fallbackQuestion(a);
        fresh[a.id] = p ? { ...base, question: p.question, summary: p.summary || base.summary, hidden: p.hidden } : base;
      }
      await saveQuestions(fresh);
    }
    return { phrased: atoms.length, total: atoms.length };
  } finally {
    prewarming = false;
  }
}

/** מריץ עבודות במקביל עד תקרה - כדי שהכנה של כל המוח לא תיתקל בהגבלת קצב */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(workers);
}

/**
 * מחזיר את שאלות הנושא, ומנסח בדרך מה שעוד לא נוסח (פעם אחת, נשמר).
 * כולל את שאלות ההעשרה מפערי הידע שהצטברו.
 */
export async function getTopicQuestions(topicKey: string): Promise<{ questions: ReviewQuestion[]; state: StateStore }> {
  const [prompt, stored, state, openQa, ov] = await Promise.all([
    activePrompt(),
    loadQuestions(),
    loadState(),
    getRepo().listLearnedQA("open").catch(() => []),
    loadOverrides(),
  ]);
  const edited = Object.values(ov.items).map((o) => o.text).filter(Boolean);
  const atoms = atomizeprompt(prompt)
    .filter((a) => a.topic === topicKey)
    // אטום שנמצא בתוך נוסח שכבר נערך - כבר הוכרע, לא שואלים עליו שוב
    .filter((a) => !decidedByOverride(edited, a.text) || !!state[a.id]);

  // ניסוח למי שעוד אין לו (או שהטקסט השתנה מאז)
  const missing = atoms.filter((a) => !stored[a.id] || stored[a.id].text !== a.text.trim());
  if (missing.length) {
    const phrased = await phraseQuestions(missing);
    for (const a of missing) {
      const p = phrased.get(a.id);
      const base = fallbackQuestion(a);
      stored[a.id] = p
        ? { ...base, question: p.question, summary: p.summary || base.summary, hidden: p.hidden }
        : base;
    }
    await saveQuestions(stored);
  }

  const questions: ReviewQuestion[] = atoms.map((a) => stored[a.id]).filter((q) => q && !q.hidden);

  // סעיפים שנמחקו אינם קיימים יותר בפרומפט, ולכן לא יוצאים מהחיתוך - בלי
  // להחזיר אותם לרשימה אי אפשר היה לחזור על מחיקה ולשחזר אותה.
  const present = new Set(atoms.map((a) => a.id));
  for (const [id, ans] of Object.entries(state)) {
    if (ans.status !== "deleted" || present.has(id)) continue;
    const q = stored[id];
    if (q && !q.hidden && q.topic === topicKey) questions.push(q);
  }

  // שאלות העשרה: מה שלקוחות שאלו והבוט לא ידע
  for (const qa of openQa) {
    if (assignTopic(qa.question) !== topicKey) continue;
    const asks = qa.askers?.length ?? 0;
    questions.push({
      id: `gap-${qa.id}`,
      kind: "enrich",
      topic: topicKey,
      question: qa.question,
      summary: "לקוחות שאלו את זה והבוט לא ידע לענות",
      evidence: asks > 1 ? `נשאל ${asks} פעמים` : undefined,
    });
  }

  return { questions, state };
}

// ===== כתיבה חזרה =====

export interface AnswerInput {
  questionId: string;
  status: AnswerStatus;
  /** טקסט חדש (changed) או התשובה (answered) */
  answer?: string;
}

/**
 * מחיל תשובה על המוח **מיד**:
 *  changed  - הסעיף מוחלף בטקסט החדש (דריסה על עוגן הטקסט המקורי)
 *  deleted  - הסעיף מוסר מהפרומפט
 *  answered - התשובה נשמרת כידע נלמד, והבוט משתמש בה מהרגע הזה
 *  unsure   - נפתחת שאלה לצוות
 * הכל הפיך: לכל שינוי נשמרת גרסה בהיסטוריית המוח.
 */
export async function applyAnswer(input: AnswerInput): Promise<{ ok: true }> {
  const { questionId, status, answer } = input;
  const repo = getRepo();
  let createdId: string | undefined;

  // שינוי החלטה שכבר ניתנה: קודם מנקים את העקבות שלה. בלי זה, מעבר מ"שנה"
  // ל"נכון השאר" היה משאיר את הדריסה הישנה בתוקף, והתשובה החדשה הייתה שקר.
  const before = await loadState();
  const prev = before[questionId];
  if (prev) {
    const wasWrite = prev.status === "changed" || prev.status === "deleted";
    const isWrite = status === "changed" || status === "deleted";
    if (wasWrite && !isWrite) await clearOverride(anchorOf(await loadQuestions(), questionId).id);
    if (prev.newId) {
      delete before[questionId];
      delete before[prev.newId];
      const qs = await loadQuestions();
      delete qs[prev.newId];
      await Promise.all([saveState(before), saveQuestions(qs)]);
    }
  }

  if (questionId.startsWith("gap-")) {
    const qaId = questionId.slice(4);
    if (status === "answered" && answer?.trim()) await repo.answerLearnedQA(qaId, answer.trim());
    else if (status === "irrelevant") await repo.deleteLearnedQA(qaId);
  } else if (status === "changed" || status === "deleted") {
    const questions = await loadQuestions();
    const q = questions[questionId];
    if (!q?.text) throw new Error("לא נמצא הטקסט המקורי של הסעיף");
    const next = status === "deleted" ? "" : (answer ?? "").trim();
    if (status === "changed" && !next) throw new Error("חסר טקסט חדש");
    // העוגן הוא תמיד הסעיף המקורי בפרומפט - גם בעריכה של נוסח שכבר נערך.
    const anchor = anchorOf(questions, questionId);
    await setAnchorOverride(anchor.id, next, anchor.text, status === "deleted" ? "הוסר בבירור המוח" : "נערך בבירור המוח");
    // הטקסט החדש הוא אטום חדש (המזהה נגזר מהתוכן) - מסמנים גם אותו כנסקר,
    // אחרת אותה החלטה הייתה חוזרת מיד כשאלה "חדשה".
    if (status === "changed") {
      const st = await loadState();
      const newId = atomId(next);
      createdId = newId;
      st[newId] = { status: "kept", at: Date.now() };
      const qs = await loadQuestions();
      qs[newId] = { ...q, id: newId, text: next, tokens: tok(next), originId: anchor.id, originText: anchor.text };
      await Promise.all([saveState(st), saveQuestions(qs)]);
    }
  } else if (status === "unsure") {
    const questions = await loadQuestions();
    const q = questions[questionId];
    await repo
      .addOpenQuestion({ question: `לבירור מול הצוות: ${q?.summary || q?.question || questionId}`, topic: "בירור המוח" })
      .catch(() => undefined);
  }

  const state = await loadState();
  state[questionId] = { status, answer: answer?.trim() || undefined, at: Date.now(), newId: createdId };
  await saveState(state);
  return { ok: true };
}

/** הסעיף המקורי בפרומפט שאליו הדריסה מעוגנת (גם אם זה כבר נוסח ערוך) */
function anchorOf(questions: QuestionStore, questionId: string): { id: string; text: string } {
  const q = questions[questionId];
  return { id: q?.originId ?? questionId, text: q?.originText ?? q?.text ?? "" };
}

/** ביטול תשובה אחת (חזרה אחורה על החלטה, והנוסח המקורי חוזר) */
export async function undoAnswer(questionId: string): Promise<void> {
  const [state, questions] = await Promise.all([loadState(), loadQuestions()]);
  const prev = state[questionId];
  const origin = questions[questionId]?.originId;
  if (origin) {
    // ביטול על נוסח שנוצר מעריכה = חזרה לסעיף המקורי. חייבים לנקות גם את
    // התשובה שנרשמה על הסעיף המקורי, אחרת הוא נשאר "מוכרע" ולא יחזור לתור.
    await clearOverride(origin);
    delete state[origin];
    delete questions[questionId];
    await saveQuestions(questions);
  } else if (prev && (prev.status === "changed" || prev.status === "deleted")) {
    await clearOverride(anchorOf(questions, questionId).id);
  }
  // הנוסח החדש שנוצר בעריכה מפסיק להתקיים - מנקים גם אותו
  if (prev?.newId) delete state[prev.newId];
  delete state[questionId];
  await saveState(state);
}
