/**
 * ניסוי: כמה טוקנים חוסכים אם ההוראות נכתבות באנגלית והדוגמאות נשארות בעברית?
 * משתמש ב-endpoint ספירת הטוקנים (חינם, לא מייצר תשובה).
 * הרצה: npx tsx scripts/lang-token-test.mts
 */
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const MODEL = "claude-sonnet-4-6";

const count = async (text: string) => {
  const r = await client.messages.countTokens({
    model: MODEL,
    system: text,
    messages: [{ role: "user", content: "x" }],
  });
  return r.input_tokens;
};

// ---- מקטע אמיתי מהפרומפט שלנו (כלל 6, העברה לנציג) ----
const HE = `6. **העברה לנציג אנושי (חכמה, לא אוטומטית).** ברשותך כלי בשם escalate_to_human. השתמש בו בתבונה:
   - אם הלקוח מבקש "נציג"/"בן אדם": **אל תעביר מיד.** הגב בחום, אמור שתשמח לעזור בעצמך, ושאל בקצרה מה הוא צריך (ותמיד אפשר נציג בהמשך). נסה קודם לפתור.
   - **תלונה מסלימה מיד, כבר בהודעה הראשונה.** לקוח שמביע תלונה, כעס, אכזבה או חוסר שביעות רצון ("אני רוצה להתלונן", "השירות היה גרוע", "חיכיתי שעה") - קרא ל-escalate_to_human כבר עכשיו, באותה תשובה. אל תשאל "מה קרה?" ואל תנסה לברר לבד קודם: שאלת בירור בלי הסלמה משאירה את הלקוח הכועס תלוי באוויר, וזה בדיוק המקום שבו הוא צריך בן אדם.
   - **מסלימים אך ורק על הרשימה הסגורה הזאת**: (1) הלקוח מתעקש שוב על נציג אחרי שהצעת עזרה; (2) תלונה/כעס/נושא רגיש; (3) בעיה/שינוי/ביטול בהזמנה קיימת; (4) פניית דרושים/עבודה. **שום דבר אחר לא מסלים.**
   - כשאתה מסלים, ב-summary כתוב סיכום קצר בעברית של מה שהלקוח צריך, כדי שהנציג יקבל הקשר מלא ולא יתחיל מאפס.
   - לעולם אל תסרב ללקוח שמתעקש על נציג.`;

// אותו כלל בדיוק, הוראות באנגלית + הדוגמאות שהלקוח כותב נשארות בעברית
const EN = `6. **HANDOFF TO A HUMAN AGENT (judgment, not automatic).** You have the tool escalate_to_human. Use it deliberately:
   - Customer asks for "נציג"/"בן אדם": **do not hand off immediately.** Reply warmly, say you'd be glad to help yourself, and ask briefly what they need (a human is always available later). Try to solve it first.
   - **A complaint escalates immediately, on its very first message.** A customer expressing a complaint, anger, disappointment or dissatisfaction ("אני רוצה להתלונן", "השירות היה גרוע", "חיכיתי שעה") - call escalate_to_human now, in this same reply. Do not ask "what happened?" and do not investigate alone first: asking without escalating leaves an angry customer hanging, which is exactly when they need a person.
   - **Escalate ONLY for this closed list**: (1) customer insists on an agent again after you offered help; (2) complaint/anger/sensitive topic; (3) problem/change/cancellation of an existing reservation; (4) job application. **Nothing else escalates.**
   - When escalating, write \`summary\` as a short Hebrew summary of what the customer needs, so the agent has full context and doesn't start from zero.
   - Never refuse a customer who insists on a human agent.`;

const [he, en] = await Promise.all([count(HE), count(EN)]);
console.log(`\n===== ניסוי שפת ההוראות (כלל 6 האמיתי שלנו) =====`);
console.log(`עברית:  ${HE.length.toLocaleString()} תווים -> ${he.toLocaleString()} טוקנים  (${(HE.length / he).toFixed(2)} תווים/טוקן)`);
console.log(`אנגלית: ${EN.length.toLocaleString()} תווים -> ${en.toLocaleString()} טוקנים  (${(EN.length / en).toFixed(2)} תווים/טוקן)`);
const save = ((he - en) / he) * 100;
console.log(`\nחיסכון: ${(he - en).toLocaleString()} טוקנים = ${save.toFixed(1)}%`);

// הרחבה לפרומפט המלא
const FULL = 36737;
const DATA_SHARE = 0.28; // תפריט + שעות + FAQ + אנשי קשר = נשאר בעברית
const instr = FULL * (1 - DATA_SHARE);
console.log(`\n--- הרחבה לפרומפט המלא (${FULL.toLocaleString()} טוקנים) ---`);
console.log(`חלק ההוראות (~${((1 - DATA_SHARE) * 100).toFixed(0)}%): ${Math.round(instr).toLocaleString()} טוקנים`);
console.log(`אחרי תרגום ההוראות: ${Math.round(instr * (1 - save / 100)).toLocaleString()} טוקנים`);
console.log(`פרומפט חדש משוער: ${Math.round(FULL * DATA_SHARE + instr * (1 - save / 100)).toLocaleString()} טוקנים`);
