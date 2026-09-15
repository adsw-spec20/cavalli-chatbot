"use client";

import { useState } from "react";
import { SectionCard } from "./ui";

/**
 * מדריכי מרכז טאביט - מדריך קצר ואינטראקטיבי לכל תת-תצוגה (יום / מפה / מעבדה).
 * כפתור "מדריך" בהאב פותח את המדריך של התצוגה הנוכחית; החלפת לשונית בזמן
 * שהמדריך פתוח מחליפה גם את המדריך. הדגמות חיות בעיצוב הפאנל - בלי צילומי מסך.
 */

export type GuideTopic = "day" | "floor" | "lab";

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[13px] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] border border-[color-mix(in_srgb,var(--accent)_30%,transparent)] rounded-xl px-3 py-2">
      💡 {children}
    </div>
  );
}

/* ================= מדריך לשונית יום ================= */

const DAY_TILES = [
  {
    key: "all",
    label: "הזמנות ביום",
    value: "16",
    desc: "הרשימה המלאה של היום הנבחר, מחולקת בוקר/ערב - כל הזמנה עם שולחן, טלפון ומצב פיקדון.",
    preview: [
      "*כל ההזמנות למחר* (16.9)",
      "16 הזמנות · 119 סועדים",
      "",
      "🌅 *בוקר*",
      "*12:30 · מיכל · 2 סועדים*",
      "ש׳ 23 | 050-456-4869 | ✅",
      "…",
    ],
  },
  {
    key: "covers",
    label: "סה״כ סועדים",
    value: "119",
    desc: "תמונת מצב מספרית של היום - בלי רשימות: סיכומים, חלוקת בוקר/ערב ושעת השיא.",
    preview: [
      "*סיכום סועדים למחר* (16.9)",
      "",
      "סה״כ *119 סועדים* ב-16 הזמנות",
      "🌅 בוקר: 21 סועדים · 5 הזמנות",
      "🌆 ערב: 98 סועדים · 11 הזמנות",
      "",
      "🍽️ שולחנות גדולים (8+): 7 · 64 סועדים",
      "💳 חסרי פיקדון: 2",
      "⏰ שעת שיא: 20:00 · 22 סועדים",
    ],
  },
  {
    key: "big",
    label: "שולחנות גדולים (8+)",
    value: "7",
    note: "2 מתוכם ללא פיקדון",
    desc: "כל הגדולים של היום. אם לחלקם אין פיקדון - האזהרה מופיעה באדום כאן על האריח.",
    preview: [
      "*שולחנות גדולים למחר* (16.9)",
      "7 הזמנות · 64 סועדים",
      "",
      "🌆 *ערב*",
      "*18:30 · אורלי · 12 סועדים*",
      "ש׳ 66 | 050-908-0030 | ❌ חסר פיקדון",
      "…",
      "*סה״כ:* 7 שולחנות גדולים · 64 סועדים",
    ],
  },
  {
    key: "missing",
    label: "חסרי פיקדון",
    value: "2",
    danger: true,
    desc: "כל מי שעוד לא שילם פיקדון - כולל חיווי אם כבר נשלחה תזכורת, כדי לא לשלוח פעמיים.",
    preview: [
      "*חסרי פיקדון למחר* (16.9)",
      "2 הזמנות · 20 סועדים",
      "",
      "*18:30 · אורלי · 12 סועדים*",
      "ש׳ 66 | 050-908-0030",
      "💳 נשלחה תזכורת · 15.9 · 17:32",
      "…",
    ],
  },
] as const;

function GuideDay() {
  const [tileKey, setTileKey] = useState<(typeof DAY_TILES)[number]["key"]>("big");
  const tile = DAY_TILES.find((t) => t.key === tileKey)!;
  return (
    <div className="space-y-4">
      <SectionCard title="📅 איך עובדת לשונית יום" sub="בוחרים יום למעלה - וכל המסך מתעדכן אליו. ברירת המחדל: היום.">
        <div className="space-y-3 text-sm leading-relaxed">
          <p>
            <b>4 האריחים</b> הם הלב של המסך, ועל כל אחד יש כפתור <b>📋 העתק</b> שמכין הודעת
            וואטסאפ מסודרת להדבקה בקבוצה. <b>לחצו על אריח כדי לראות מה יוצא ממנו:</b>
          </p>

          {/* אריחים אינטראקטיביים */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {DAY_TILES.map((t) => (
              <button
                key={t.key}
                onClick={() => setTileKey(t.key)}
                className={`relative text-right bg-[var(--panel)] rounded-xl px-3 py-2.5 border-2 transition ${
                  tileKey === t.key ? "border-[var(--accent)]" : "border-[var(--border)] hover:border-[color-mix(in_srgb,var(--accent)_45%,transparent)]"
                }`}
              >
                <span className="absolute top-1.5 left-1.5 text-[9px] rounded-md px-1 py-0.5 border border-[var(--border)] text-[var(--muted)]">📋</span>
                <span className={`block text-xl font-bold font-display ${"danger" in t && t.danger ? "text-red-400" : "text-[var(--text)]"}`} style={{ fontVariantNumeric: "tabular-nums" }}>
                  {t.value}
                </span>
                <span className="block text-[10px] text-[var(--muted)] mt-0.5 leading-tight">{t.label}</span>
                {"note" in t && t.note && <span className="block text-[9px] font-semibold text-red-400 mt-0.5">{t.note}</span>}
              </button>
            ))}
          </div>

          <div className="grid sm:grid-cols-2 gap-2 items-start">
            <p className="text-[var(--muted)]">{tile.desc}</p>
            <div dir="rtl" className="bg-[var(--panel2)] border border-[var(--border)] rounded-xl px-3 py-2 text-[11.5px] leading-relaxed select-none">
              <div className="text-[9px] text-[var(--muted)] mb-1">ככה זה ייראה בוואטסאפ:</div>
              {tile.preview.map((l, i) =>
                l === "" ? <div key={i} className="h-1.5" /> : (
                  <div key={i} className={l.startsWith("*") ? "font-semibold text-[var(--text)]" : "text-[var(--muted)]"}>
                    {l.replace(/\*/g, "")}
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="ומה עוד יש במסך">
        <ul className="text-sm space-y-1.5 pr-5 list-disc marker:text-[var(--accent)] leading-relaxed">
          <li><b>גרף העומס</b> - כמה סועדים בכל שעה. ביום הנוכחי מופיע קו אדום של "עכשיו".</li>
          <li><b>חסר פיקדון</b> - לחיצה על הזמנה פותחת את הפרטים, ומשם שולחים ללקוח תזכורת בוואטסאפ עם קישור התשלום שלו. תמיד עם אישור לפני, ותמיד רואים אם כבר נשלחה.</li>
          <li><b>יומן הזמנות</b> - הכל או גדולות בלבד (סינון 6+/8+/10+/12+), חיפוש לפי שם / טלפון / שולחן. לחיצה על שורה = כרטיס מלא עם הערות וקישור להזמנה בטאביט.</li>
          <li><b>📋 העתק רשימה</b> - למעלה ביומן: רשימת מארחות פשוטה (שם · שולחן · טלפון) לתחילת משמרת.</li>
        </ul>
      </SectionCard>
    </div>
  );
}

/* ================= מדריך מפת רצפה ================= */

const FLOOR_STATES = [
  { key: "free",   label: "פנוי",         dot: "bg-emerald-500", box: "bg-emerald-500/15 border-emerald-500/60 text-emerald-500", desc: "השולחן חופשי - אפשר להושיב." },
  { key: "soon",   label: "שמור בקרוב",   dot: "bg-sky-500",     box: "bg-sky-500/15 border-sky-500/60 text-sky-500",             desc: "הזמנה מגיעה בשעה הקרובה - לא להושיב מזדמנים לזמן ארוך." },
  { key: "seated", label: "תפוס",         dot: "bg-zinc-500",    box: "bg-zinc-500/25 border-zinc-500/60 text-[var(--muted)]",    desc: "יושבים עכשיו. בלחיצה רואים מי, מתי התיישבו וכמה זמן נשאר." },
  { key: "ending", label: "לקראת סיום",   dot: "bg-amber-500",   box: "bg-amber-500/20 border-amber-500/70 text-amber-500",       desc: "נותרו עד 20 דק' לזמן שהוקצב - השולחן מתפנה בקרוב." },
  { key: "over",   label: "מעבר לזמן",    dot: "bg-red-500",     box: "bg-red-500/20 border-red-500/70 text-red-500",             desc: "הזמן שהוקצב נגמר. אם מחכים לשולחן - זה המקום לבדוק." },
  { key: "dirty",  label: "בניקוי",       dot: "bg-violet-500",  box: "bg-violet-500/15 border-violet-500/60 text-violet-500",    desc: "השולחן מתפנה ומנוקה - עוד רגע חוזר להיות פנוי." },
] as const;

function GuideFloor() {
  const [stateKey, setStateKey] = useState<(typeof FLOOR_STATES)[number]["key"]>("ending");
  const st = FLOOR_STATES.find((s) => s.key === stateKey)!;
  return (
    <div className="space-y-4">
      <SectionCard title="🗺️ איך קוראים את המפה" sub="אותו סידור בדיוק כמו בטאביט - הצבע מספר את הסיפור">
        <div className="space-y-3 text-sm leading-relaxed">
          <p><b>לחצו על מצב כדי לראות איך הוא נראה:</b></p>
          <div className="flex flex-wrap gap-1.5">
            {FLOOR_STATES.map((s) => (
              <button
                key={s.key}
                onClick={() => setStateKey(s.key)}
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 border text-xs transition ${
                  stateKey === s.key ? "border-[var(--accent)] bg-[var(--panel2)] text-[var(--text)] font-semibold" : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
                }`}
              >
                <span className={`w-2.5 h-2.5 rounded-full ${s.dot}`} />
                {s.label}
              </button>
            ))}
          </div>

          {/* שולחן הדגמה */}
          <div className="flex items-center gap-4 bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-4">
            <div className={`relative shrink-0 w-[72px] h-[72px] rounded-full border-2 grid place-items-center ${st.box}`}>
              <span className="text-center leading-none">
                <span className="block font-bold text-[17px]" style={{ fontVariantNumeric: "tabular-nums" }}>67</span>
                <span className="block opacity-75 font-medium text-[10px] mt-0.5">10 מק׳</span>
              </span>
              {st.key === "over" && <span className="absolute -top-1.5 -right-1.5 text-[13px]">⏳</span>}
            </div>
            <p className="text-[var(--muted)]">{st.desc}</p>
          </div>

          <Tip>המקרא במסך האמיתי הוא גם מסנן: לחיצה על "לקראת סיום" מדליקה רק את השולחנות האלה. יש גם סינון פנים / חוץ.</Tip>
        </div>
      </SectionCard>

      <SectionCard title="ניווט ולחיצה על שולחן">
        <div className="space-y-3 text-sm leading-relaxed">
          <ul className="space-y-1.5 pr-5 list-disc marker:text-[var(--accent)]">
            <li><b>גוררים</b> כדי לזוז, <b>צובטים</b> (או גלגלת במחשב) כדי להתקרב. לא כל השולחנות במסך אחד - בדיוק כמו בטאביט.</li>
            <li><b>לחיצה על שולחן</b> פותחת כרטיס עם כל הסיפור שלו; לחיצה בצד סוגרת.</li>
            <li><b>🔄 רענון חי</b> מושך עדכון מטאביט ברגע זה (הנתונים מתעדכנים לבד כל ~5 דק').</li>
          </ul>

          {/* כרטיס שולחן לדוגמה */}
          <div
            className="max-w-[380px] border-2 rounded-2xl p-3 text-[13px] space-y-1 select-none"
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
    </div>
  );
}

/* ================= מדריך מעבדה ================= */

const LAB_EXAMPLES = [
  "כמה מוזמנים יש היום בערב?",
  "תמצא לי את ההזמנה של מיכל",
  "איזה שולחנות פנויים עכשיו?",
  "מי לא שילם פיקדון למחר?",
  "מתי שולחן 40 מתפנה?",
];

function GuideLab() {
  const [demo, setDemo] = useState("");
  return (
    <div className="space-y-4">
      <SectionCard title="💬 איך עובדת המעבדה" sub="שואלים בעברית חופשית - הבוט עונה מהנתונים החיים של טאביט">
        <div className="space-y-3 text-sm leading-relaxed">
          <p>
            כותבים כמו שמדברים - אין ניסוח "נכון". <b>נסו ללחוץ על שאלה:</b>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {LAB_EXAMPLES.map((q) => (
              <button
                key={q}
                onClick={() => setDemo(q)}
                className={`text-xs border rounded-full px-3 py-1.5 transition ${
                  demo === q ? "border-[var(--accent)] text-[var(--accent)] font-semibold" : "border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                }`}
              >
                {q}
              </button>
            ))}
          </div>
          <div className="flex gap-2 max-w-[440px]">
            <input
              readOnly
              value={demo}
              placeholder="ככה זה במעבדה: הצ'יפ ממלא את השדה 👆"
              className="flex-1 bg-[var(--panel)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm outline-none"
            />
            <span className="rounded-xl px-3 py-2 text-sm bg-[var(--accent)] text-[var(--accent-fg)] font-semibold opacity-60 select-none">שלח</span>
          </div>
          <p className="text-[var(--muted)]">
            בדיוק כמו כאן - במעבדה הצ'יפ רק ממלא את השדה: אפשר לערוך, להשלים פרטים ורק אז לשלוח.
          </p>
        </div>
      </SectionCard>

      <SectionCard title="שלוש נקודות ששוות זהב">
        <ul className="text-sm space-y-1.5 pr-5 list-disc marker:text-[var(--accent)] leading-relaxed">
          <li><b>הבוט זוכר את השיחה</b> - אפשר להמשיך: "ומה הטלפון שלה?", "ותבדוק גם למחר". יוצאים וחוזרים - וממשיכים מאותה נקודה.</li>
          <li><b>העתק לוואטסאפ</b> - מתחת לכל תשובה. מעתיק אותה בפורמט נקי ומסודר להדבקה בקבוצה.</li>
          <li><b>אי אפשר לקלקל</b> - המעבדה רק קוראת נתונים. שום שאלה לא משנה כלום בטאביט.</li>
        </ul>
      </SectionCard>
    </div>
  );
}

/* ================= העטיפה ================= */

const TOPIC_TITLE: Record<GuideTopic, string> = { day: "יום", floor: "מפת רצפה", lab: "מעבדה" };

export default function TabitGuide({ topic, onClose }: { topic: GuideTopic; onClose: () => void }) {
  return (
    <div className="space-y-4 max-w-[760px]">
      <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
        <span>📖 מדריך: <b className="text-[var(--text)]">{TOPIC_TITLE[topic]}</b></span>
        <span>· החלפת לשונית למעלה מחליפה גם את המדריך</span>
      </div>

      {topic === "day" && <GuideDay />}
      {topic === "floor" && <GuideFloor />}
      {topic === "lab" && <GuideLab />}

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={onClose}
          className="rounded-xl px-4 py-2 text-sm bg-[var(--accent)] text-[var(--accent-fg)] font-semibold"
        >
          הבנתי, חזרה למסך ←
        </button>
        <span className="text-[11px] text-[var(--muted)]">הכל לצפייה בלבד · הנתונים מתעדכנים כל ~5 דק'</span>
      </div>
    </div>
  );
}
