import { businessConfig } from "@/lib/business-config";

export const metadata = {
  title: "מדיניות פרטיות",
};

export default function Privacy() {
  const name = businessConfig.name;
  const phone = businessConfig.contact.phone;
  const today = new Date().toLocaleDateString("he-IL");

  return (
    <main className="min-h-screen bg-white text-neutral-900 p-6" dir="rtl">
      <div className="max-w-2xl mx-auto leading-relaxed">
        <h1 className="text-2xl font-bold mb-2">מדיניות פרטיות - {name}</h1>
        <p className="text-sm text-neutral-500 mb-6">עודכן: {today}</p>

        <p className="mb-4">
          {name} מפעיל עוזר דיגיטלי (בוט) שמשיב להודעות לקוחות בערוצי וואטסאפ,
          פייסבוק מסנג'ר ואינסטגרם. מסמך זה מסביר איזה מידע נאסף, כיצד נעשה בו
          שימוש, וכיצד אנו שומרים עליו.
        </p>

        <h2 className="text-lg font-semibold mt-5 mb-2">איזה מידע אנו אוספים</h2>
        <ul className="list-disc pr-6 space-y-1">
          <li>תוכן ההודעות שאתם שולחים לעוזר הדיגיטלי.</li>
          <li>מזהה המשתמש בפלטפורמה (מספר טלפון בוואטסאפ, או מזהה משתמש בפייסבוק/אינסטגרם).</li>
          <li>שם הפרופיל הציבורי, אם הפלטפורמה מספקת אותו.</li>
        </ul>

        <h2 className="text-lg font-semibold mt-5 mb-2">למה אנו משתמשים במידע</h2>
        <ul className="list-disc pr-6 space-y-1">
          <li>כדי לענות על פניות ולספק שירות לקוחות (מידע על תפריט, שעות, הזמנות וכו').</li>
          <li>כדי להעביר את השיחה לנציג אנושי מהצוות כשצריך.</li>
          <li>כדי לשפר את איכות המענה.</li>
        </ul>

        <h2 className="text-lg font-semibold mt-5 mb-2">שיתוף מידע</h2>
        <p>
          איננו מוכרים את המידע שלכם ואיננו משתפים אותו עם צדדים שלישיים למטרות
          שיווק. המידע מעובד באמצעות ספקי תשתית ובינה מלאכותית לצורך מתן השירות
          בלבד.
        </p>

        <h2 className="text-lg font-semibold mt-5 mb-2">שמירת מידע</h2>
        <p>
          אנו שומרים את היסטוריית השיחות לצורך המשכיות השירות ושיפורו. ניתן לבקש
          מחיקה של המידע שלכם בכל עת.
        </p>

        <h2 className="text-lg font-semibold mt-5 mb-2">הזכויות שלכם</h2>
        <p>
          אתם רשאים לבקש לעיין במידע שנאסף עליכם, לתקן אותו, או למחוק אותו. בכל
          שלב ניתן לבקש לדבר עם נציג אנושי.
        </p>

        <h2 className="text-lg font-semibold mt-5 mb-2">יצירת קשר</h2>
        <p>
          לכל שאלה או בקשה בנושא פרטיות, ניתן לפנות אלינו
          {phone ? ` בטלפון ${phone}` : ""}.
        </p>
      </div>
    </main>
  );
}
