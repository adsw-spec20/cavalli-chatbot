# צ'אטבוט עסקי חכם 🤖

בוט שעונה על שאלות לקוחות בוואטסאפ, מסנג'ר ואינסטגרם — עם שליטה מלאה, מידע
ספציפי על העסק, וסירוב מנומס לשאלות לא רלוונטיות. בנוי על Next.js + Claude.

## הרעיון: הפרדה בין "המוח" לבין "הערוצים"

כל הלוגיקה של הבוט יושבת מאחורי שכבת הפשטה אחידה. לכן אפשר לבנות ולבדוק את
**כל** ההתנהגות דרך ה-Playground המקומי — בלי לחכות לאישורים של מטא.

```
            ┌──────────────────────────────┐
            │  המוח: Claude + ידע העסק      │
            │  + guardrails (על מה לענות)   │
            └──────────────┬───────────────┘
                           │ ממשק אחיד
        ┌──────────────────┼──────────────────┐
   [Playground]       [WhatsApp]        [IG / Messenger]
   ✅ עכשיו           ⏳ כשמטא מאשר      ⏳ בהמשך
```

## התחלה מהירה (5 דקות, בלי מטא)

```bash
npm install
cp .env.example .env.local      # ב-Windows PowerShell: copy .env.example .env.local
# ערוך את .env.local והכנס ANTHROPIC_API_KEY
npm run dev
```

פתח <http://localhost:3000/playground> ודבר עם הבוט. זה אותו מוח בדיוק שישרת
את וואטסאפ.

## איך מזינים את הבוט במידע על העסק

ערוך קובץ אחד בלבד: [`src/lib/business-config.ts`](src/lib/business-config.ts).
שם מגדירים שירותים, מחירים, שעות, שו"ת, טון דיבור, נושאים אסורים, ומתי להעביר
לנציג אנושי.

את "כללי הברזל" (איך הבוט מסרב, איך נשמר ההקשר וכו') אפשר לכוונן ב-
[`src/lib/system-prompt.ts`](src/lib/system-prompt.ts).

## מבנה הפרויקט

| קובץ | תפקיד |
|------|-------|
| `src/lib/business-config.ts` | **כל הידע על העסק** — הקובץ שעורכים |
| `src/lib/system-prompt.ts` | בונה את ההוראות + ה-guardrails |
| `src/lib/claude.ts` | המוח — קורא ל-Claude API |
| `src/lib/channels/types.ts` | פורמט הודעה אחיד לכל הערוצים |
| `src/lib/channels/whatsapp.ts` | מתאם WhatsApp Cloud API |
| `src/lib/conversation-service.ts` | מחבר הודעות לשיחות מתמשכות (משמש את כל הערוצים) |
| `src/lib/knowledge-retrieval.ts` | שליפת תפריט חכמה (חיסכון בעלות) |
| `src/lib/db/` | שכבת נתונים: ממשק Repository + מימוש קובץ (פיתוח), Postgres בפרודקשן |
| `src/app/playground/` | ממשק בדיקה מקומי |
| `src/app/api/chat/` | endpoint של ה-Playground |
| `src/app/api/webhooks/whatsapp/` | webhook לקבלת הודעות וואטסאפ |

## חיבור WhatsApp (כשמגיעים לזה)

1. צור אפליקציה ב-<https://developers.facebook.com> והוסף מוצר **WhatsApp**.
2. תקבל **מספר טסט** מיידי + `PHONE_NUMBER_ID` ו-`ACCESS_TOKEN` זמני.
3. מלא אותם ב-`.env.local` יחד עם `WHATSAPP_VERIFY_TOKEN` (מחרוזת שתמציא).
4. פרוס ל-Vercel (`vercel`), והגדר את ה-webhook במטא לכתובת:
   `https://<your-app>.vercel.app/api/webhooks/whatsapp` עם אותו verify token.
5. שלח הודעה ממספרך למספר הטסט — הבוט יענה.

> מסנג'ר ואינסטגרם עובדים באותו עיקרון (Graph API). מוסיפים adapter נוסף
> תחת `src/lib/channels/` ו-webhook מקביל. התשתית כבר מוכנה לזה.

## הערות לפרודקשן

- **זיכרון שיחה:** `conversation-store.ts` שומר בזיכרון בלבד. על Vercel
  (פונקציות stateless) צריך להחליף ל-Redis (Upstash) או Postgres (Neon).
- **אבטחת webhook:** מומלץ לאמת חתימת `X-Hub-Signature-256` של מטא.
- **מודל:** ברירת המחדל `claude-sonnet-4-6` (איזון מצוין של איכות/מחיר).
