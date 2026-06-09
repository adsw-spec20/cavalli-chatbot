# תוכנית עלייה לאוויר - קפה קוואלי 🚀

מסמך זה הוא המפה המלאה לחיבור הבוט לוואטסאפ, מסנג'ר ואינסטגרם, בצורה
מקצועית ובלי לפגוע בזרימה הקיימת של המסעדה.

## שתי אבני דרך

1. **חי לבדיקות** (אתה + צוות + בודקים): ימים ספורים. לא דורש אישור Meta.
2. **חי לציבור** (כל מי ששולח הודעה): 1-3 שבועות, נחסם בעיקר ע"י Meta.

## עקרונות בטיחות (לכל אורך הדרך)

- 🔴 **כפתור כיבוי** בפאנל: רגע אחד והבוט שותק, חוזרים ל-100% אנושי.
- 🧪 בודקים הכל על **מספר טסט / מצב פיתוח** לפני שנוגעים בערוץ החי.
- 📈 מתחילים מערוץ אחד, מרחיבים לפי ביטחון.
- 🙋 הצוות תמיד יכול להשתלט (בנוי).

---

## Phase 0 - דרישות מקדימות (וידוא שיש לך)

- [ ] **חשבון Meta Business** (business.facebook.com) עם הרשאת אדמין.
- [ ] **עמוד פייסבוק** של המסעדה.
- [ ] **חשבון אינסטגרם מקצועי (Professional)** המקושר לעמוד הפייסבוק.
- [ ] **מספר וואטסאפ עסקי** (הקיים, או חדש להחלטה).
- [ ] מסמכי עסק לאימות (ח.פ/עוסק, אסמכתא לכתובת).

---

## Phase 1 - הקמת התשתית ב-Meta (החלק האיטי, מתחילים ראשון)

### 1.1 אימות עסק (Business Verification) - להתחיל היום
- ב-business.facebook.com → Settings → Business Info / Security Center → Start Verification.
- ממלאים פרטי עסק, מעלים מסמכים. **לוקח 1-5 ימי עסקים.** זה הצוואר בקבוק, לכן מתחילים ממנו.

### 1.2 יצירת אפליקציית Meta
- developers.facebook.com → My Apps → Create App → סוג "Business".
- מקשרים אותה ל-Business שלך.

### 1.3 הוספת המוצרים
- באפליקציה: Add Product → **Messenger**, **Instagram**, **WhatsApp** (כולם).

---

## Phase 2 - חיבור הערוצים (אני מלווה, כל ערוץ בנפרד)

לכל ערוץ צריך: (א) להגדיר webhook, (ב) להשיג טוקן, (ג) שאני אכניס אותם ל-Vercel.

**כתובות ה-webhook שלנו (כבר חיות):**
- Messenger: `https://cavalli-chatbot.vercel.app/api/webhooks/messenger`
- Instagram: `https://cavalli-chatbot.vercel.app/api/webhooks/instagram`
- WhatsApp: `https://cavalli-chatbot.vercel.app/api/webhooks/whatsapp`

### 2.1 Messenger (מומלץ להתחיל מכאן - הכי פשוט)
1. Messenger → Settings → Webhooks → Add Callback URL.
   - Callback URL: הכתובת של Messenger למעלה.
   - Verify Token: מחרוזת שתמציא (תשלח לי, אכניס ל-`MESSENGER_VERIFY_TOKEN`).
2. Subscribe to fields: `messages`, `messaging_postbacks`.
3. Connect את עמוד הפייסבוק, וצור **Page Access Token** (תשלח לי → `MESSENGER_PAGE_ACCESS_TOKEN`).

### 2.2 Instagram
1. Instagram → Webhooks → אותו תהליך, עם הכתובת של Instagram.
   - Verify Token → `INSTAGRAM_VERIFY_TOKEN`.
2. Subscribe to `messages`.
3. Page Access Token של העמוד המקושר → `INSTAGRAM_PAGE_ACCESS_TOKEN`.

### 2.3 WhatsApp
1. WhatsApp → API Setup → תקבל **מספר טסט** מיד + `Phone Number ID` + טוקן זמני.
2. Webhook: הכתובת של WhatsApp + Verify Token (`WHATSAPP_VERIFY_TOKEN`), subscribe to `messages`.
3. אני מכניס `WHATSAPP_PHONE_NUMBER_ID` + `WHATSAPP_ACCESS_TOKEN`.
4. **אישור שם תצוגה** + (בהמשך) **מיגרציית המספר האמיתי** - השלב העדין, נתכנן בנפרד.

### 2.4 אבטחה
- אעדכן את `META_APP_SECRET` (מ-App Settings → Basic) לאימות חתימת ה-webhooks.

---

## Phase 3 - בדיקות חי (מצב פיתוח, אפס סיכון לציבור)

- במצב פיתוח, הבוט עונה רק לאנשים שהגדרת כ-Testers/Admins של האפליקציה.
- מוסיפים אותך + כמה מהצוות, ומדברים עם הבוט באמת במסנג'ר/אינסטגרם/וואטסאפ-טסט.
- בודקים: מענה, הסלמה לאדם, השתלטות נציג, נקודות הקלדה, רצף הודעות.

---

## Phase 4 - השקה רכה (לציבור, בזהירות)

- אחרי שעברנו App Review (ראה Phase 5), פותחים ערוץ אחד לציבור.
- מתחילים אולי בשעות מסוימות / עם מעקב צמוד בפאנל.
- כפתור הכיבוי תמיד בהישג יד.
- מרחיבים לערוצים הנוספים לפי ביטחון.

---

## Phase 5 - App Review (לפתיחה לציבור)

- צריך להגיש בקשה ל-Meta עבור ההרשאות: `pages_messaging` (מסנג'ר),
  `instagram_manage_messages` (אינסטגרם). וואטסאפ לא דורש את זה למענה בסיסי.
- נדרש: דף מדיניות פרטיות (יש: `/privacy`), הסבר use-case, וסרטון הדגמה.
- **לוקח ימים עד ~שבועיים.** אכין את כל החומר.

---

## מה אני צריך ממך, ובאיזה סדר

1. **עכשיו:** להתחיל את **אימות העסק** (1.1) כי הוא הכי איטי.
2. **במקביל:** ליצור את **אפליקציית Meta** (1.2-1.3).
3. **ואז, ערוץ-ערוץ:** לשלוח לי את ה-Verify Tokens וה-Page Access Tokens, ואני מחבר.

מתחילים ממסנג'ר. אני כאן ללוות בכל קליק.
