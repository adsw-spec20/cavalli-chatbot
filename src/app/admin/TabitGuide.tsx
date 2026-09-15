"use client";

import { SectionCard } from "./ui";

/**
 * מדריך מרכז טאביט - עמוד הסבר קצר לצוות, יושב בתוך ההאב (כפתור "מדריך").
 * בלי צילומי מסך: הדגמות חיות באותו עיצוב של המסכים האמיתיים - תמיד עדכני.
 */

/** תגית מצב של שולחן במפה - אותם צבעים כמו במפה האמיתית */
function StateChip({ dot, label, desc }: { dot: string; label: string; desc: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={`w-3 h-3 rounded-full shrink-0 ${dot}`} />
      <b className="shrink-0">{label}</b>
      <span className="text-[var(--muted)]">{desc}</span>
    </div>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[13px] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] border border-[color-mix(in_srgb,var(--accent)_30%,transparent)] rounded-xl px-3 py-2">
      💡 {children}
    </div>
  );
}

export default function TabitGuide() {
  return (
    <div className="space-y-4 max-w-[760px]">
      <div className="text-sm text-[var(--muted)] leading-relaxed">
        מרכז טאביט מציג תמונה חיה של ההזמנות והמסעדה, ישירות מטאביט. הכל <b className="text-[var(--text)]">לצפייה בלבד</b> -
        אי אפשר לקלקל כאן שום דבר בטאביט. הנתונים מתעדכנים לבד כל ~5 דקות, ו"🔄 רענון חי" מושך עדכון ברגע זה.
      </div>

      {/* ===== לשונית יום ===== */}
      <SectionCard title="📅 לשונית יום" sub="כל מה שקורה ביום אחד - הזמנות, עומס ופיקדונות">
        <div className="space-y-3 text-sm leading-relaxed">
          <p>
            <b>בורר הימים למעלה</b> - כל הימים הקרובים שיש בהם הזמנות. בוחרים יום, וכל המסך מתעדכן אליו.
            ברירת המחדל היא היום.
          </p>

          <div>
            <b>4 האריחים</b> - המספרים החשובים של היום הנבחר, ועל כל אריח כפתור <b>📋 העתק</b> שמכין
            הודעת וואטסאפ מסודרת ומוכנה להדבקה בקבוצה:
            <ul className="mt-1.5 space-y-1 pr-5 list-disc marker:text-[var(--accent)]">
              <li><b>הזמנות ביום</b> - הרשימה המלאה, מחולקת 🌅 בוקר / 🌆 ערב, עם שולחן, טלפון ומצב פיקדון לכל הזמנה.</li>
              <li><b>סה״כ סועדים</b> - סיכום מספרי: כמה סועדים והזמנות, חלוקת בוקר/ערב, שולחנות גדולים, חסרי פיקדון ושעת השיא.</li>
              <li><b>שולחנות גדולים</b> - כל הגדולים של היום עם כל הפרטים. אם חלקם בלי פיקדון - זה מופיע באדום על האריח עצמו.</li>
              <li><b>חסרי פיקדון</b> - כל מי שעוד לא שילם, כולל חיווי אם כבר נשלחה לו תזכורת.</li>
            </ul>
          </div>

          {/* הדגמה: אריח עם כפתור העתק */}
          <div className="grid grid-cols-2 gap-2 max-w-[420px]">
            <div className="relative bg-[var(--panel)] border border-[var(--border)] rounded-xl px-3 py-2.5 pointer-events-none select-none">
              <span className="absolute top-1.5 left-1.5 text-[10px] rounded-md px-1.5 py-0.5 border border-[var(--border)] text-[var(--muted)]">📋 העתק</span>
              <div className="text-2xl font-bold font-display text-[var(--accent)]">7</div>
              <div className="text-[11px] text-[var(--muted)] mt-0.5">שולחנות גדולים (8+)</div>
              <div className="text-[10px] font-semibold text-red-400 mt-0.5">2 מתוכם ללא פיקדון</div>
            </div>
            <div dir="rtl" className="bg-[var(--panel2)] border border-[var(--border)] rounded-xl px-3 py-2 text-[11px] leading-relaxed text-[var(--muted)] select-none">
              <div className="font-bold text-[var(--text)]">*שולחנות גדולים להיום* (16.9)</div>
              <div>7 הזמנות · 64 סועדים</div>
              <div className="mt-1">🌆 <b>ערב</b></div>
              <div className="font-semibold text-[var(--text)]">18:30 · אורלי · 12 סועדים</div>
              <div>ש׳ 66 | 050-908-0030 | ✅</div>
              <div className="mt-0.5 opacity-60">…וכן הלאה</div>
            </div>
          </div>

          <p>
            <b>גרף העומס</b> - כמה סועדים בכל שעה. כשמסתכלים על היום הנוכחי יש קו אדום של "עכשיו".
          </p>
          <p>
            <b>חסר פיקדון</b> - רשימת ההזמנות שדורשות פיקדון והוא לא שולם. לחיצה על הזמנה פותחת את הפרטים,
            ומשם אפשר לשלוח ללקוח תזכורת בוואטסאפ עם קישור התשלום (תמיד עם אישור לפני השליחה).
          </p>
          <p>
            <b>יומן הזמנות</b> - כל ההזמנות של היום לפי שעה. אפשר להציג הכל או גדולות בלבד (עם סינון 6+/8+/10+/12+),
            ולחפש לפי שם, טלפון או מספר שולחן. לחיצה על שורה פותחת כרטיס מלא עם הערות, טלפון להתקשרות וקישור להזמנה בטאביט.
          </p>
        </div>
      </SectionCard>

      {/* ===== מפת רצפה ===== */}
      <SectionCard title="🗺️ מפת רצפה" sub="המפה האמיתית של המסעדה, בדיוק כמו בטאביט">
        <div className="space-y-3 text-sm leading-relaxed">
          <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
            <StateChip dot="bg-emerald-500" label="פנוי" desc="השולחן חופשי" />
            <StateChip dot="bg-sky-500" label="שמור בקרוב" desc="הזמנה מגיעה בשעה הקרובה" />
            <StateChip dot="bg-zinc-500" label="תפוס" desc="יושבים עכשיו" />
            <StateChip dot="bg-amber-500" label="לקראת סיום" desc="נותרו עד 20 דק' לזמן שהוקצב" />
            <StateChip dot="bg-red-500" label="מעבר לזמן" desc="הזמן שהוקצב נגמר" />
            <StateChip dot="bg-violet-500" label="בניקוי" desc="השולחן מתפנה" />
          </div>

          <Tip>המקרא הוא גם מסנן - לחיצה על "לקראת סיום" מדליקה רק את השולחנות האלה. יש גם סינון פנים/חוץ.</Tip>

          <p>
            <b>ניווט</b> - גוררים כדי לזוז, צובטים (או גלגלת במחשב) כדי להתקרב. המפה נפתחת כשכל רוחב
            הרצפה במסך; לא כל השולחנות נכנסים בבת אחת - בדיוק כמו בטאביט.
          </p>
          <p>
            <b>לחיצה על שולחן</b> פותחת כרטיס: מי יושב עכשיו, כמה זמן כבר יושבים וכמה נותר,
            ומי ההזמנה הבאה שמחכה לשולחן. לחיצה בצד סוגרת את הכרטיס.
          </p>

          {/* הדגמה: כרטיס שולחן */}
          <div
            className="max-w-[380px] border-2 rounded-2xl p-3 text-[13px] space-y-1 select-none pointer-events-none"
            style={{
              background: "color-mix(in srgb, var(--accent) 16%, var(--panel))",
              borderColor: "color-mix(in srgb, var(--accent) 60%, transparent)",
            }}
          >
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-zinc-500" />
              <b className="font-display">שולחן 67</b>
              <span className="text-[11px] text-[var(--muted)]">חוץ · 10 מקומות · תפוס</span>
            </div>
            <div>יושבים: <b>נטלי</b> · 8 סועדים</div>
            <div className="text-[var(--muted)]">יושבים כבר 34 דק' · נותרו ~86 דק' לזמן שהוקצב</div>
            <div className="border-t border-[color-mix(in_srgb,var(--accent)_35%,transparent)] pt-1">
              ההזמנה הבאה: <b>21:00</b> · יפעת · 7 סועדים
            </div>
          </div>
        </div>
      </SectionCard>

      {/* ===== מעבדה ===== */}
      <SectionCard title="💬 מעבדה" sub="שואלים בעברית חופשית - ומקבלים תשובה מהנתונים החיים">
        <div className="space-y-3 text-sm leading-relaxed">
          <p>
            צ'אט שמחובר לנתוני טאביט. שואלים כמו שמדברים:
            {" "}<i>"כמה מוזמנים יש היום בערב?"</i> · <i>"תמצא לי את ההזמנה של מיכל"</i> ·{" "}
            <i>"איזה שולחנות פנויים עכשיו?"</i> · <i>"מי לא שילם פיקדון למחר?"</i>
          </p>
          <p>
            הצ'יפים המוכנים ממלאים את השדה - אפשר לערוך ולהשלים לפני השליחה. השיחה נשמרת,
            אז אפשר לצאת ולחזור ולהמשיך מאותה נקודה, והבוט זוכר על מה דיברתם.
          </p>
          <Tip>מתחת לכל תשובה יש "העתק לוואטסאפ" - מעתיק את התשובה בפורמט נקי ומסודר להדבקה בקבוצה.</Tip>
        </div>
      </SectionCard>

      {/* ===== פיקדון מהתיבת פניות ===== */}
      <SectionCard title="💳 תזכורת פיקדון" sub="נמצא בתיבת הפניות - כפתור 'פיקדון'">
        <div className="space-y-2 text-sm leading-relaxed">
          <p>
            כפתור <b>💳 פיקדון</b> בתיבת הפניות פותח את רשימת כל ההזמנות שעוד לא שילמו פיקדון,
            מסודרות לפי ימים (היום, מחר, וכן הלאה) עם חיפוש לפי שם או טלפון.
          </p>
          <p>
            בוחרים לקוח, מאשרים - והלקוח מקבל וואטסאפ אחד עם קישור התשלום האמיתי שלו מטאביט.
            אחרי שליחה מופיע חיווי <b>"💳 נשלחה תזכורת"</b> עם תאריך ושעה, כדי שאף אחד לא ישלח פעמיים.
          </p>
        </div>
      </SectionCard>

      {/* ===== שווה לדעת ===== */}
      <SectionCard title="✨ שווה לדעת">
        <ul className="text-sm space-y-1.5 pr-5 list-disc marker:text-[var(--accent)] leading-relaxed">
          <li>הנתונים מתעדכנים אוטומטית כל ~5 דקות. "🔄 רענון חי" מושך עדכון מטאביט ברגע זה (לוקח עד ~20 שניות).</li>
          <li>הכל לצפייה בלבד - שום פעולה כאן לא משנה כלום בטאביט, אז אפשר להסתובב בלי חשש.</li>
          <li>מספרי הטלפון לחיצים - נגיעה מחייגת, וכפתור הוואטסאפ פותח שיחה עם הלקוח.</li>
          <li>אפשר לשמור קישור ישיר למסך הזה: <code className="text-[var(--text)] bg-[var(--panel2)] rounded px-1">/admin#tabit</code></li>
        </ul>
      </SectionCard>
    </div>
  );
}
