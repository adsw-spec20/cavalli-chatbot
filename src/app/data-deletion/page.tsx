import { businessConfig } from "@/lib/business-config";

export const metadata = {
  title: "מחיקת מידע / Data Deletion",
};

export default function DataDeletion() {
  const name = businessConfig.name;
  const phone = businessConfig.contact.phone;
  const today = new Date().toLocaleDateString("he-IL");

  return (
    <main className="min-h-screen bg-white text-neutral-900 p-6" dir="rtl">
      <div className="max-w-2xl mx-auto leading-relaxed">
        <h1 className="text-2xl font-bold mb-2">הוראות מחיקת מידע - {name}</h1>
        <p className="text-sm text-neutral-500 mb-6">עודכן: {today}</p>

        <p className="mb-4">
          {name} מפעיל עוזר דיגיטלי (בוט) שמשיב להודעות לקוחות בוואטסאפ, פייסבוק
          מסנג'ר ואינסטגרם. אתם רשאים לבקש בכל עת למחוק את המידע שנשמר עליכם.
        </p>

        <h2 className="text-lg font-semibold mt-5 mb-2">איזה מידע נמחק</h2>
        <ul className="list-disc pr-6 space-y-1">
          <li>היסטוריית ההודעות שלכם מול העוזר הדיגיטלי.</li>
          <li>מזהה המשתמש שלכם בפלטפורמה (מספר טלפון / מזהה פייסבוק/אינסטגרם).</li>
          <li>שם הפרופיל וכל פרט שנשמר על השיחה.</li>
        </ul>

        <h2 className="text-lg font-semibold mt-5 mb-2">איך לבקש מחיקה</h2>
        <ol className="list-decimal pr-6 space-y-1">
          <li>
            שלחו לנו הודעה באחד מהערוצים (וואטסאפ / מסנג'ר / אינסטגרם) עם הבקשה
            &quot;אנא מחקו את המידע שלי&quot;, או בקשו לדבר עם נציג אנושי.
          </li>
          {phone && <li>לחלופין, ניתן להתקשר אלינו בטלפון {phone}.</li>}
          <li>
            נאמת את זהותכם (לפי אותו חשבון/מספר שממנו פניתם) ונמחק את המידע שלכם.
          </li>
        </ol>

        <h2 className="text-lg font-semibold mt-5 mb-2">תוך כמה זמן</h2>
        <p>
          נטפל בבקשתכם ונמחק את המידע תוך 30 ימים לכל היותר, אלא אם החוק מחייב
          אותנו לשמור חלק מהמידע לתקופה ארוכה יותר.
        </p>

        <hr className="my-8 border-neutral-200" />

        <div dir="ltr" className="text-left">
          <h2 className="text-lg font-semibold mb-2">Data Deletion Instructions (English)</h2>
          <p className="mb-3">
            {name} operates a customer-support assistant on WhatsApp, Facebook
            Messenger and Instagram. You may request deletion of your data at any
            time.
          </p>
          <p className="mb-2 font-medium">How to request deletion:</p>
          <ol className="list-decimal pl-6 space-y-1">
            <li>
              Send us a message on any channel (WhatsApp / Messenger / Instagram)
              saying &quot;Please delete my data&quot;, or ask to speak with a
              human representative.
            </li>
            {phone && <li>Or call us at {phone}.</li>}
            <li>
              We verify your identity (via the same account/number you contacted
              us from) and delete the data we hold about you.
            </li>
          </ol>
          <p className="mt-3">
            We process deletion requests within 30 days, unless we are legally
            required to retain certain information for longer.
          </p>
        </div>
      </div>
    </main>
  );
}
