/**
 * תובנות: סיווג הודעות לקוחות לנושאים.
 *
 * סיווג דטרמיניסטי לפי מילות מפתח (בלי מודל = חינם ומיידי). לא מושלם,
 * אבל נותן לבעל העסק תמונה ברורה של "על מה שואלים אותנו" - שזה מה שחשוב.
 * משמש גם את הדשבורד וגם את הדוח היומי.
 */

export const TOPIC_RULES: { topic: string; keywords: string[] }[] = [
  { topic: "שעות פתיחה", keywords: ["פתוח", "שעות", "סגור", "מתי", "פותח", "סוגר", "מוצש", "מוצ\"ש", "שבת", "היום עד"] },
  { topic: "תפריט ומחירים", keywords: ["תפריט", "מחיר", "כמה עולה", "עולה", "מנה", "קפה", "קפוצ", "קרואסון", "פיצה", "פסטה", "סלט", "קינוח", "שקשוקה", "בוקר", "יין", "קוקטייל", "שתיה", "שתייה"] },
  { topic: "חניה והגעה", keywords: ["חני", "חונ", "להגיע", "מגיעים", "וויז", "waze", "ניווט", "כתובת", "איפה אתם", "מיקום"] },
  { topic: "הזמנת מקום", keywords: ["להזמין", "הזמנה", "שולחן", "מקום ל", "לשריין", "שריון", "reservation", "טאביט", "tabit"] },
  { topic: "אירועים והקרנות", keywords: ["הקרנ", "משחק", "מונדיאל", "אירוע", "מסך", "משדרים", "שידור"] },
  { topic: "כשרות", keywords: ["כשר", "כשרות", "בדץ", "בד\"ץ", "חלבי", "בשרי"] },
  { topic: "תזונה ואלרגיות", keywords: ["טבעוני", "צמחוני", "גלוטן", "אלרגי", "לקטוז", "אגוזים", "בוטנים", "רגישות"] },
  { topic: "נציג ושירות", keywords: ["נציג", "בן אדם", "מישהו אנושי", "תלונה", "מתלונן", "שירות", "מנהל"] },
];

const OTHER = "אחר";

/** מסווג הודעת לקוח לנושא (הראשון שמתאים). */
export function classifyTopic(text: string): string {
  const t = (text || "").toLowerCase();
  for (const rule of TOPIC_RULES) {
    if (rule.keywords.some((k) => t.includes(k))) return rule.topic;
  }
  return OTHER;
}

/** פילוח נושאים מרשימת הודעות, ממוין מהנפוץ לנדיר. */
export function topicBreakdown(texts: string[]): { topic: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const t of texts) {
    const topic = classifyTopic(t);
    counts.set(topic, (counts.get(topic) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([topic, count]) => ({ topic, count }));
}
