"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Heebo, Frank_Ruhl_Libre } from "next/font/google";
import { api, type ConvItem, type QuickReply, type PanelSettings } from "./types";
import { unsavedChanges, setUnsaved } from "./dirty";
import Inbox, { type InboxFilterIntent } from "./Inbox";

// ביצועים במובייל: רק תיבת הפניות נטענת מיד; שאר המסכים נטענים בעצלתיים
// כשנכנסים אליהם בפעם הראשונה - הטלפון מוריד ומפענח הרבה פחות קוד בכניסה.
const lazyLoading = () => (
  <div className="p-8 text-center text-sm text-[var(--muted)]">טוען…</div>
);
const Dashboard = dynamic(() => import("./Dashboard"), { loading: lazyLoading });
const Knowledge = dynamic(() => import("./Knowledge"), { loading: lazyLoading });
const BusinessEditor = dynamic(() => import("./BusinessEditor"), { loading: lazyLoading });
const Settings = dynamic(() => import("./Settings"), { loading: lazyLoading });
const Media = dynamic(() => import("./Media"), { loading: lazyLoading });
const Reservations = dynamic(() => import("./Reservations"), { loading: lazyLoading });
const Questionnaire = dynamic(() => import("./Questionnaire"), { loading: lazyLoading });
const TestChat = dynamic(() => import("./TestChat"), { loading: lazyLoading });

// טיפוגרפיה: Heebo לגוף (קריא ונקי בעברית), Frank Ruhl Libre לכותרות ומספרים (תחושת מסעדה יוקרתית)
const fontBody = Heebo({ subsets: ["hebrew", "latin"], weight: ["400", "500", "600", "700"] });
const fontDisplay = Frank_Ruhl_Libre({ subsets: ["hebrew", "latin"], weight: ["500", "700"] });

/**
 * מערכת העיצוב: גווני אבן חמים + מבטא זהב (אווירת קוואלי), צל רך לכל כרטיס,
 * טבעות פוקוס נגישות, גלילה מעוצבת. הכרטיסים מקבלים צל אוטומטית דרך בורר
 * ה-substring על bg-[var(--panel)] - בלי לגעת בכל קומפוננטה.
 */
const THEME_CSS = `
[data-theme="dark"]{
  --bg:#131110;--panel:#1c1917;--panel2:#272220;--border:#3a332c;
  --text:#f1ede6;--muted:#a89f92;--accent:#d9a441;--accent-fg:#211a0e;
  --ring:rgba(217,164,65,.45);
  --shadow-card:0 1px 2px rgba(0,0,0,.4),0 10px 28px -14px rgba(0,0,0,.55);
  --glow:radial-gradient(1100px 480px at 80% -10%,rgba(217,164,65,.08),transparent 62%);
}
[data-theme="light"]{
  --bg:#f8f5ef;--panel:#ffffff;--panel2:#f1ebe0;--border:#e2d9c8;
  --text:#241f19;--muted:#6d6355;--accent:#a3770f;--accent-fg:#ffffff;
  --ring:rgba(163,119,15,.4);
  --shadow-card:0 1px 2px rgba(40,28,8,.05),0 10px 28px -14px rgba(40,28,8,.14);
  --glow:radial-gradient(1100px 480px at 80% -10%,rgba(163,119,15,.06),transparent 62%);
}
[class*="bg-[var(--panel)]"]{box-shadow:var(--shadow-card)}
/* טקסט צבעוני בהיר (צ'יפים/תגיות/כפתורים שעוצבו לרקע כהה): בתצוגה בהירה
   ממפים לגוונים כהים קריאים - תיקון גלובלי אחד בלי לגעת בכל קומפוננטה. */
[data-theme="light"] .text-amber-200,[data-theme="light"] .text-amber-300{color:#8a6508}
[data-theme="light"] .text-emerald-300,[data-theme="light"] .text-emerald-400{color:#047857}
[data-theme="light"] .text-blue-300{color:#1d4ed8}
[data-theme="light"] .text-pink-300{color:#be185d}
[data-theme="light"] .text-sky-300{color:#0369a1}
[data-theme="light"] .text-neutral-300,[data-theme="light"] .text-neutral-400{color:#525252}
[data-theme="light"] .text-purple-300{color:#7e22ce}
[data-theme="light"] .text-red-300,[data-theme="light"] .text-red-400{color:#b91c1c}
/* מובייל: העמוד עצמו לעולם לא נגלל (רק אזורי התוכן הפנימיים) - בלי זה iOS
   דוחף את העמוד כשהמקלדת נפתחת ונשאר "חור" שחור מתחת לאפליקציה.
   clip (ולא רק hidden): ב-iOS עמוד עם תוכן רחב מהמסך עדיין נגרר הצידה עם
   hidden - clip חוסם את זה לגמרי; דפדפנים ישנים נופלים חזרה ל-hidden. */
html,body{height:100%;overflow:hidden;overflow:clip;overscroll-behavior:none}
/* מגע: מבטל את השהיית הקליק של iOS (~350ms) על כל כפתור - הלחיצה מגיבה מיד */
button,a,[role="button"]{touch-action:manipulation}
/* שורת שיחה ברשימה: משוב לחיצה מיידי (בלי אנימציה) - שיהיה ברור שהמגע נקלט */
.conv-row:active{background:var(--panel2)!important;transition:none!important}
/* בכוונה בלי content-visibility על שורות/הודעות: ב-iOS הוא גורם לקפיצות גלילה
   (הדפדפן מנחש גבהים ומתקן תוך כדי). במקום זה הרשימה מרנדרת עד 60 שורות
   והשיחה עד 120 הודעות - מהיר בלי ניחושים. */
/* iOS: מקלדת שנפתחת על שדה עם פונט קטן מ-16px גורמת לזום אוטומטי - והמסך
   נשאר מוגדל ו"נגרר" הצידה גם אחרי הסגירה (גלילה שבורה, קפיצות). 16px בשדות
   במובייל מבטל את הזום האוטומטי; זום ידני של המשתמש נשאר אפשרי. */
@media (max-width:767px){input,textarea,select{font-size:16px}}
.font-display{font-family:var(--font-display),'Frank Ruhl Libre',serif}
*{scrollbar-width:thin;scrollbar-color:var(--border) transparent}
::-webkit-scrollbar{width:8px;height:8px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:8px}
::-webkit-scrollbar-thumb:hover{background:var(--muted)}
::selection{background:var(--accent);color:var(--accent-fg)}
:focus-visible{outline:2px solid var(--ring);outline-offset:2px;border-radius:8px}
button{cursor:pointer}
button,a{transition:color .15s,background-color .15s,border-color .15s,box-shadow .2s,opacity .15s,transform .15s}
button:not(:disabled):active{transform:translateY(1px)}
input,textarea,select{transition:border-color .15s,box-shadow .15s}
input:focus,textarea:focus,select:focus{box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 18%,transparent)}
/* בר "ממתין לנציג": הבהוב עדין (מסגרת + זוהר נושם) שמושך תשומת לב בלי להיות אגרסיבי.
   הטקסט נשאר קריא לחלוטין; מכובד ע"י prefers-reduced-motion למטה. */
@keyframes await-pulse{
  0%,100%{border-color:rgba(249,115,22,.5);box-shadow:0 0 0 0 rgba(249,115,22,0);background-color:rgba(249,115,22,.12)}
  50%{border-color:rgba(249,115,22,1);box-shadow:0 0 18px 2px rgba(249,115,22,.55);background-color:rgba(249,115,22,.26)}
}
.await-pulse{animation:await-pulse 1.3s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important}}
.no-scrollbar::-webkit-scrollbar{display:none}.no-scrollbar{scrollbar-width:none}
`;

type Tab = "inbox" | "reservations" | "knowledge" | "questionnaire" | "dashboard" | "business" | "media" | "test" | "settings";
// הסדר לפי תדירות שימוש: פניות -> לימוד הבוט -> נתונים -> תחזוקה
const TABS: { key: Tab; label: string }[] = [
  { key: "inbox", label: "תיבת פניות" },
  { key: "reservations", label: "הזמנות" },
  { key: "knowledge", label: "ידע" },
  { key: "questionnaire", label: "שאלון" },
  { key: "dashboard", label: "דשבורד" },
  { key: "business", label: "מידע עסקי" },
  { key: "media", label: "מדיה" },
  { key: "test", label: "בדיקת בוט" },
  { key: "settings", label: "הגדרות" },
];
/** הטאבים שמופיעים בסרגל התחתון במובייל (התדירים ביותר; דשבורד זמין דרך "עוד") */
const BOTTOM_TABS: Tab[] = ["inbox", "knowledge", "reservations"];

/** כותרת + תת-כותרת אחידה לכל עמוד (בדסקטופ) - נותן לכל מסך עוגן מסודר */
const TAB_META: Record<Exclude<Tab, "inbox">, { title: string; subtitle: string }> = {
  reservations: { title: "הזמנות מקום", subtitle: "אישור בקשות, אג'נדת ההזמנות הקרובות והיסטוריה - הלקוח מקבל כל תשובה ישירות בצ'אט" },
  knowledge: { title: "ניהול ידע", subtitle: "שאלות שהבוט לא ידע לענות עליהן, והידע שכבר נלמד - כל תשובה שנשמרת נכנסת לתוקף מיד" },
  questionnaire: { title: "שאלון הידע", subtitle: "234 שאלות שנבנו מניתוח כל השיחות - כל תשובה נשמרת מיד ומוטמעת לבוט" },
  dashboard: { title: "דשבורד", subtitle: "תמונת מצב חיה: עומס, ערוצים, נושאים ומגמות" },
  business: { title: "מידע עסקי", subtitle: "שעות, תפריט, תאריכים מיוחדים ופרטי קשר - הבוט מתעדכן מיד עם השמירה" },
  media: { title: "ספריית מדיה", subtitle: "תמונות וסרטונים שהבוט שולח ללקוחות כשרלוונטי" },
  test: { title: "בדיקת בוט", subtitle: "שיחת ניסיון עם הבוט - בדיוק כמו שלקוח רואה אותה" },
  settings: { title: "הגדרות", subtitle: "צוות, התראות, עלויות ותחזוקה" },
};

/** אייקוני SVG (בסגנון Lucide) - נקיים ומקצועיים, במקום אימוג'י */
const ICON_PATHS: Record<Tab, ReactNode> = {
  inbox: (
    <>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </>
  ),
  reservations: (
    <>
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M3 10h18" />
      <path d="m9 16 2 2 4-4" />
    </>
  ),
  knowledge: (
    <>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </>
  ),
  questionnaire: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </>
  ),
  dashboard: (
    <>
      <path d="M3 3v18h18" />
      <path d="M18 17V9" />
      <path d="M13 17V5" />
      <path d="M8 17v-3" />
    </>
  ),
  business: (
    <>
      <path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" />
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4" />
      <path d="M2 7h20" />
    </>
  ),
  media: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </>
  ),
  test: (
    <>
      <path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2" />
      <path d="M8.5 2h7" />
      <path d="M7 16h10" />
    </>
  ),
  settings: (
    <>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
};

function TabIcon({ tab, className }: { tab: Tab; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "w-[18px] h-[18px] shrink-0"}
      aria-hidden
    >
      {ICON_PATHS[tab]}
    </svg>
  );
}

/** אייקון רענון (בסגנון Lucide) - מסתובב בזמן סנכרון */
function RefreshIcon({ spinning, className }: { spinning?: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${className ?? "w-[18px] h-[18px]"} shrink-0 ${spinning ? "animate-spin" : ""}`}
      aria-hidden
    >
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

/** לוגו המותג: אריח זהב מוזהב עם C בסריף */
function BrandMark({ size = "w-9 h-9 text-lg" }: { size?: string }) {
  return (
    <div
      className={`${size} rounded-xl grid place-items-center font-bold text-[#211a0e] shadow-[0_2px_10px_-2px_rgba(217,164,65,.5)] ${fontDisplay.className}`}
      style={{ background: "linear-gradient(135deg,#ecc56c 0%,#d9a441 55%,#a87a24 100%)" }}
      aria-hidden
    >
      C
    </div>
  );
}

/** משתני עיצוב שמוזרקים לשורש: הילת רקע עדינה + פונט הכותרות כמשתנה CSS */
const themeRootStyle = {
  backgroundImage: "var(--glow)",
  "--font-display": fontDisplay.style.fontFamily,
} as CSSProperties;

function beep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    o.start();
    o.stop(ctx.currentTime + 0.4);
  } catch {
    /* ignore */
  }
}

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [authError, setAuthError] = useState("");
  // כניסת צוות: שם + קוד אישי. מנהל: טוקן מלא.
  const [loginMode, setLoginMode] = useState<"team" | "master">("team");
  const [loginName, setLoginName] = useState("");
  const [loginCode, setLoginCode] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [role, setRole] = useState<"master" | "agent">("agent");

  const [theme, setTheme] = useState<"dark" | "light">("light");
  const [tab, setTab] = useState<Tab>("inbox");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [notify, setNotify] = useState(false);
  const [voice, setVoice] = useState(false);

  const [alarm, setAlarm] = useState<{ ts: number; reason: string } | null>(null);
  const [conversations, setConversations] = useState<ConvItem[]>([]);
  const [convsLoaded, setConvsLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<QuickReply[]>([]);
  // מחוות "אחורה" בפאנל (בקשות משתמש 25.8): צ'אט פתוח - החלקה סוגרת אותו;
  // בלי צ'אט - ההחלקה נבלעת ולא קורה כלום (אף פעם לא עוזבים את הפאנל).
  // שלושה דגלים: רשומת הצ'אט, רשומת הבסיס ("בולעת" החלקות), וסימון pop
  // שאנחנו יזמנו בעצמנו (history.back בסגירת צ'אט מכפתור) שיש להתעלם ממנו.
  const convShieldArmed = useRef(false);
  const baseShieldArmed = useRef(false);
  const expectOwnPop = useRef(false);
  const [openQuestions, setOpenQuestions] = useState(0);
  const [pendingResv, setPendingResv] = useState(0);
  // כשכל 234 שאלות השאלון נענו - הטאב מוסתר אוטומטית (לבקשת המשתמש)
  const [quizComplete, setQuizComplete] = useState(false);
  const [botEnabled, setBotEnabled] = useState(true);
  const knownEscalations = useRef<Set<string>>(new Set());
  const pollFailures = useRef(0);
  const lastConvsJson = useRef("");
  // חותמת המשיכה המוצלחת האחרונה: אחרי הקפאת רקע (טלפון נעול שעות) הרשימה
  // בזיכרון עתיקה - התראות שנגזרות ממנה מושתקות עד שמגיע דאטה טרי (תקרית 23.8)
  const lastSyncOk = useRef(0);
  // רענון ידני (כפתור בכותרת): ספינר בזמן משיכה יזומה של הכל
  const [syncing, setSyncing] = useState(false);
  // רענון ידני: מונה שמרכיב מחדש את תוכן הטאב (רענון אמיתי של המסך), ודגל "✓ עודכן"
  const [refreshTick, setRefreshTick] = useState(0);
  const [justSynced, setJustSynced] = useState(false);
  // רענון עדין פעם בדקה רק בשביל תוויות הזמן היחסי ("לפני 3 ד'") - עכשיו
  // שהסקר מדלג על רינדור כשאין שינוי, בלי זה התוויות היו קופאות.
  const [, setRelTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setRelTick((x) => x + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  const [offline, setOffline] = useState(false);

  // כוונות ניווט בין מסכים (דשבורד -> אינבוקס מסונן, ידע -> בדיקת בוט)
  const [inboxIntent, setInboxIntent] = useState<InboxFilterIntent | null>(null);
  const [testPrefill, setTestPrefill] = useState<string | null>(null);

  useEffect(() => {
    setToken(localStorage.getItem("admin_token") || "");
    // ברירת המחדל: בהיר. המפתח הוחלף (admin_theme_v2) כי הגרסה הישנה שמרה
    // "כהה" אוטומטית אצל כולם - וזו לא הייתה בחירה אמיתית של המשתמש.
    setTheme((localStorage.getItem("admin_theme_v2") as "dark" | "light") || "light");
    setAgentName(localStorage.getItem("agent_name") || "");
    setVoice(localStorage.getItem("admin_voice") === "1");
    setNotify(typeof Notification !== "undefined" && Notification.permission === "granted");
    if (!localStorage.getItem("admin_token")) setAuthed(false);
  }, []);

  useEffect(() => localStorage.setItem("admin_theme_v2", theme), [theme]);
  useEffect(() => localStorage.setItem("agent_name", agentName), [agentName]);
  useEffect(() => localStorage.setItem("admin_voice", voice ? "1" : "0"), [voice]);

  // גובה אמיתי של אזור התצוגה: כשמקלדת המובייל נפתחת, ה-visual viewport מתכווץ
  // אבל dvh לא (iOS). מעדכנים משתנה CSS כדי ששדה ההקלדה יישאר מעל המקלדת.
  // בנוסף, iOS "דוחף" את כל העמוד למעלה (pan) כשהמקלדת נפתחת - בלי החזרת הגלילה
  // לאפס נשאר מסך שחור מתחת לאפליקציה (דיווח משתמש 9.8). מאזינים גם ל-scroll של
  // ה-viewport ומיישרים חזרה; הפריסה כבר בגובה הנראה, אז שדה הקלט נשאר גלוי.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let raf = 0;
    let settle: ReturnType<typeof setTimeout> | undefined;
    // מצב אבחון: /admin?vpdebug=1 מציג נתוני viewport חיים (לתחקור טלפון בעייתי)
    const debug = new URLSearchParams(window.location.search).has("vpdebug");
    const update = () => {
      if (debug) {
        let el = document.getElementById("vp-debug");
        if (!el) {
          el = document.createElement("div");
          el.id = "vp-debug";
          el.style.cssText =
            "position:fixed;top:4px;left:4px;z-index:99999;background:#000c;color:#0f0;font:11px monospace;padding:6px 8px;border-radius:8px;direction:ltr;max-width:95vw;word-break:break-all;pointer-events:none";
          document.body.appendChild(el);
        }
        el.textContent = `vvH=${vv.height.toFixed(0)} scale=${vv.scale.toFixed(3)} top=${vv.offsetTop.toFixed(0)} innerH=${window.innerHeight} scrollY=${window.scrollY} | ${navigator.userAgent.slice(0, 90)}`;
      }
      if (vv.scale > 1.01) return; // בזום ידני לא נוגעים בפריסה
      document.documentElement.style.setProperty("--app-h", `${vv.height}px`);
      if (vv.offsetTop > 0 || window.scrollY !== 0) window.scrollTo(0, 0);
    };
    const onChange = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
      // עדכון נוסף אחרי שאנימציית המקלדת של iOS נגמרת (הגבהים מתייצבים באיחור)
      clearTimeout(settle);
      settle = setTimeout(update, 350);
    };
    update();
    vv.addEventListener("resize", onChange);
    vv.addEventListener("scroll", onChange);
    window.addEventListener("scroll", onChange, { passive: true });
    return () => {
      vv.removeEventListener("resize", onChange);
      vv.removeEventListener("scroll", onChange);
      window.removeEventListener("scroll", onChange);
      cancelAnimationFrame(raf);
      clearTimeout(settle);
    };
  }, []);

  // קישור עמוק מהתראת פוש: /admin?conv=<id> פותח ישר את השיחה. מסלול א' -
  // כניסה טרייה עם הפרמטר ב-URL (הפאנל היה סגור). הפרמטר מנוקה אחרי השימוש
  // כדי שרענון לא יכריח את אותה שיחה שוב.
  useEffect(() => {
    if (authed !== true) return;
    const params = new URLSearchParams(window.location.search);
    const conv = params.get("conv");
    if (!conv) return;
    openConversation(conv);
    params.delete("conv");
    const qs = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  // מטפל מחוות האחורה: צ'אט פתוח - סוגר אותו (כמו בוואטסאפ); אחרת בולע את
  // המחווה (דוחף את רשומת הבסיס מחדש) - שום דבר לא קורה והפאנל נשאר.
  useEffect(() => {
    const onPop = () => {
      if (expectOwnPop.current) {
        expectOwnPop.current = false;
        return;
      }
      if (convShieldArmed.current) {
        convShieldArmed.current = false;
        setSelectedId(null);
        return;
      }
      if (baseShieldArmed.current) {
        window.history.pushState({ cavalliBase: true }, "");
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // מגן הבסיס מתחמש רק אחרי המגע הראשון של המשתמש בפאנל, לא בטעינה:
  // רשומת היסטוריה שנוצרת בלי אינטראקציה אמיתית מסומנת בדפדפן כ"ניתנת
  // לדילוג" (הגנה מפני חטיפת כפתור האחורה) ומחוות אחורה פשוט מתעלמת ממנה -
  // זו הסיבה שהניסיון הראשון נכשל כשהגיעו לפאנל מאתר אחר.
  useEffect(() => {
    if (authed !== true) return;
    const arm = () => {
      if (!baseShieldArmed.current) {
        baseShieldArmed.current = true;
        window.history.pushState({ cavalliBase: true }, "");
      }
    };
    window.addEventListener("pointerdown", arm, { passive: true });
    window.addEventListener("keydown", arm);
    return () => {
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("keydown", arm);
    };
  }, [authed]);

  // פתיחת צ'אט דוחפת רשומת היסטוריה - שמחוות "אחורה" תסגור את הצ'אט במקום
  // לצאת מהאתר. סגירה מכפתור החזרה (לא ממחווה) צורכת את הרשומה בעצמה
  // (history.back), כך שההיסטוריה נשארת נקייה והחלקה הבאה מתנהגת רגיל.
  useEffect(() => {
    const open = tab === "inbox" && !!selectedId;
    if (open && !convShieldArmed.current) {
      convShieldArmed.current = true;
      window.history.pushState({ cavalliConv: true }, "");
    } else if (!open && convShieldArmed.current) {
      convShieldArmed.current = false;
      expectOwnPop.current = true;
      window.history.back();
    }
  }, [tab, selectedId]);

  // מסלול ב' - הפאנל כבר פתוח והמשתמש לחץ על התראה: ה-service worker שולח
  // לנו הודעה עם היעד, ואנחנו פותחים את השיחה בלי טעינה מחדש.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type !== "open-url") return;
      const m = String(e.data.url || "").match(/[?&]conv=([A-Za-z0-9%-]+)/);
      if (m) openConversation(decodeURIComponent(m[1]));
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!token) return;
    api<PanelSettings>(token, "/settings")
      .then((s) => {
        setAuthed(true);
        setAuthError("");
        setBotEnabled(s.botEnabled);
        setRole(s.role);
        setAlarm(s.alarm ?? null);
        // איש צוות: השם מגיע מהכניסה - נקבע אוטומטית ומופיע על כל תשובה
        if (s.role === "agent" && s.name) setAgentName(s.name);
        localStorage.setItem("admin_token", token);
      })
      .catch((e) => {
        setAuthed(false);
        setAuthError(e instanceof Error && e.message === "unauthorized" ? "קוד גישה שגוי" : "לא ניתן להתחבר לשרת");
      });
  }, [token]);

  /** כניסת איש צוות בשם + קוד */
  async function submitTeamLogin() {
    if (!loginName.trim() || !loginCode.trim() || loggingIn) return;
    setLoggingIn(true);
    setAuthError("");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: loginName, code: loginCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "כניסה נכשלה");
      setAgentName(data.name);
      setAuthed(null);
      setToken(data.token);
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : "כניסה נכשלה");
    } finally {
      setLoggingIn(false);
    }
  }

  /** כניסת מנהל: מאמת את הקוד בשרת (ומקבל עוגיית התחברות לשער האתר) */
  async function submitMasterLogin() {
    const code = tokenInput.trim();
    if (!code || loggingIn) return;
    setLoggingIn(true);
    setAuthError("");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ master: code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "קוד גישה שגוי");
      setAuthed(null);
      setToken(code);
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : "כניסה נכשלה");
    } finally {
      setLoggingIn(false);
    }
  }

  const loadConversations = useCallback(async () => {
    if (!token) return;
    try {
      const list = await api<ConvItem[]>(token, "/conversations");
      // ביצועים (חשוב במובייל): אם שום דבר לא השתנה מאז המשיכה הקודמת, לא נוגעים
      // ב-state - כך הסקר של כל 4 שניות לא גורם לרינדור מחדש של כל הפאנל
      // (זה מה שגרם להקלדה מקוטעת ולתחושת איטיות בטלפון).
      const json = JSON.stringify(list);
      if (json !== lastConvsJson.current) {
        lastConvsJson.current = json;
        setConversations(list);
      }
      // חזרה מרקע אחרי הקפאה ארוכה: גם אם הרשימה לא השתנתה מכריחים רינדור
      // אחד (דרך טיקר הזמן) - שהתראת "ערוץ שקט" ותוויות הזמן יתעדכנו מיד
      const wasStale = Date.now() - lastSyncOk.current > 90_000;
      lastSyncOk.current = Date.now();
      if (wasStale) setRelTick((x) => x + 1);
      setConvsLoaded(true);
      pollFailures.current = 0;
      setOffline(false);
      for (const c of list) {
        if (c.escalated && !knownEscalations.current.has(c.id)) {
          knownEscalations.current.add(c.id);
          if (voice) beep();
          if (notify && typeof Notification !== "undefined" && Notification.permission === "granted") {
            new Notification(`${c.urgent ? "🔴 דחוף - " : ""}הסלמה חדשה — קפה קוואלי`, {
              body: `${c.customerName || "לקוח"}: ${c.lastMessage || ""}`,
            });
          }
        } else if (c.escalated) {
          knownEscalations.current.add(c.id);
        }
      }
    } catch {
      // אחרי 3 כשלונות רצופים מציגים באנר "אין חיבור" במקום להסתיר את הבעיה
      pollFailures.current += 1;
      if (pollFailures.current >= 3) setOffline(true);
    }
  }, [token, notify, voice]);

  useEffect(() => {
    if (!authed) return;
    loadConversations();
    // ברקע (טאב מוסתר / טלפון נעול) לא סוקרים - onWake מושך הכל מיד בחזרה
    const t = setInterval(() => {
      if (document.visibilityState === "visible") loadConversations();
    }, 4000);
    return () => clearInterval(t);
  }, [authed, loadConversations]);

  useEffect(() => {
    if (!authed || tab !== "inbox") return; // התבניות משמשות רק את האינבוקס
    api<QuickReply[]>(token, "/templates").then(setTemplates).catch(() => {});
  }, [authed, token, tab]);

  // מוני הבועות האדומות על הלשוניות: שאלות פתוחות בידע + הזמנות ממתינות
  // (מתרעננים כל 30 שניות, בכל מעבר טאב, וגם ברענון הידני)
  // ביצועים: בקשה אחת קטנה (/badges) במקום שלוש תשובות מלאות רק בשביל לספור
  const loadBadges = useCallback(() => {
    if (!token) return Promise.resolve();
    return api<{ openQuestions: number; pendingReservations: number; quizDone: number }>(token, "/badges")
      .then((b) => {
        setOpenQuestions(b.openQuestions);
        setPendingResv(b.pendingReservations);
        setQuizComplete(b.quizDone >= 234);
      })
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!authed) return;
    loadBadges();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") loadBadges();
    }, 30_000);
    return () => clearInterval(t);
  }, [authed, loadBadges, tab]);

  /** משיכת מצב מערכת (אזעקה + בוט פעיל/כבוי) - משמש גם את הסקר וגם רענון יזום */
  const refreshSettings = useCallback(() => {
    if (!token) return Promise.resolve();
    return api<PanelSettings>(token, "/settings")
      .then((s) => {
        setAlarm(s.alarm ?? null);
        setBotEnabled(s.botEnabled);
      })
      .catch(() => {});
  }, [token]);

  // רענון אזעקת המערכת כל דקה - שהצוות יידע מיד אם הבוט נפל (לקח מתקרית 3.8)
  useEffect(() => {
    if (!authed) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") refreshSettings();
    }, 60_000);
    return () => clearInterval(t);
  }, [authed, refreshSettings]);

  // 📱 חזרה מרקע: הטלפון מקפיא טאב ברקע (כולל סקר ה-4 שניות), ובפתיחה מחדש
  // הפאנל מצייר רגע ארוך צילום ישן של הבוקר. מושכים הכל מיד ברגע שהטאב חוזר
  // להיות גלוי - גם בפתיחה מקיצור דרך במסך הבית וגם בשחזור מ-bfcache (תקרית 23.8)
  useEffect(() => {
    if (!authed) return;
    const onWake = () => {
      if (document.visibilityState !== "visible") return;
      loadConversations();
      refreshSettings();
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("pageshow", onWake);
    return () => {
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("pageshow", onWake);
    };
  }, [authed, loadConversations, refreshSettings]);

  /**
   * רענון ידני: מרענן באמת את הכל - שיחות, מצב מערכת, מוני לשוניות, וגם את תוכן
   * המסך הנוכחי (הרכבה מחדש, כמו יציאה וחזרה לטאב - כל מסך מושך נתונים טריים).
   * באינבוקס אין הרכבה מחדש (הרשימה חיה ממילא בסקר, והרכבה הייתה מוחקת טיוטת
   * תשובה פתוחה), וכך גם כשיש שינויים שלא נשמרו במסך עריכה.
   * משוב ברור: ספינר לפחות חצי שנייה ואז ✓ - כדי שיהיה ודאי שקרה משהו,
   * גם כשהנתונים כבר היו מעודכנים ושום דבר לא השתנה על המסך.
   */
  async function manualRefresh() {
    if (syncing) return;
    setSyncing(true);
    setJustSynced(false);
    const started = Date.now();
    if (tab !== "inbox" && !unsavedChanges.current) setRefreshTick((t) => t + 1);
    await Promise.all([loadConversations(), refreshSettings(), loadBadges()]);
    setRelTick((x) => x + 1); // רינדור אחד לקליפת הפאנל - תוויות זמן/באנרים מתעדכנים גם כשהרשימה לא השתנתה
    const wait = 500 - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    setSyncing(false);
    setJustSynced(true);
    window.setTimeout(() => setJustSynced(false), 1600);
  }

  async function clearAlarm() {
    setAlarm(null);
    try {
      await api(token, "/settings", { method: "POST", body: JSON.stringify({ clearAlarm: true }) });
    } catch {
      /* לא קריטי */
    }
  }

  async function toggleBot() {
    const next = !botEnabled;
    try {
      await api(token, "/settings", { method: "POST", body: JSON.stringify({ botEnabled: next }) });
      setBotEnabled(next);
    } catch {
      /* השרת לא אישר - לא משנים תצוגה */
    }
  }

  const attention = conversations.filter((c) => c.awaiting && c.status !== "closed").length;

  // 🕳️ גלאי "ערוץ שקט חשוד": אפס הודעות נכנסות 3+ שעות בשעות הפעילות = ייתכן
  // נתק בערוצים (טוקן שפג, webhook שנפל). מחושב מהרשימה שכבר נטענת - בלי עלות.
  const quietAlert = (() => {
    if (!convsLoaded) return null;
    // רק על דאטה טרי: אם המשיכה המוצלחת האחרונה ישנה (טאב שחזר מהקפאת רקע),
    // הרשימה בזיכרון לא משקפת מציאות - עדיף רגע בלי באנר מאשר אזעקת שווא
    if (Date.now() - lastSyncOk.current > 90_000) return null;
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", hour12: false }).format(new Date())
    );
    const day = new Date().toLocaleDateString("en-US", { timeZone: "Asia/Jerusalem", weekday: "short" });
    if (day === "Sat" || hour < 9 || hour >= 22) return null; // מחוץ לשעות פעילות סבירות
    const lastInbound = Math.max(0, ...conversations.filter((c) => c.channel !== "playground").map((c) => c.lastUserTs ?? 0));
    if (!lastInbound) return null;
    const quietH = (Date.now() - lastInbound) / 3600_000;
    return quietH >= 3 ? Math.floor(quietH) : null;
  })();

  // ===== מסך התחברות =====
  if (authed === false) {
    return (
      <div data-theme={theme} className={`min-h-dvh grid place-items-center bg-[var(--bg)] text-[var(--text)] p-4 ${fontBody.className}`} style={themeRootStyle} dir="rtl">
        <style dangerouslySetInnerHTML={{ __html: THEME_CSS }} />
        <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-6 w-full max-w-sm space-y-3">
          <div className="text-center">
            <div className="mx-auto mb-3 w-fit"><BrandMark size="w-14 h-14 text-3xl" /></div>
            <div className={`text-3xl font-bold tracking-wide ${fontDisplay.className}`}>קפה קוואלי</div>
            <div className="text-xs text-[var(--muted)] mt-1 tracking-wider">פאנל ניהול ושירות</div>
          </div>

          {loginMode === "team" ? (
            <>
              <input
                value={loginName}
                onChange={(e) => setLoginName(e.target.value)}
                placeholder="השם שלך"
                aria-label="שם איש צוות"
                autoComplete="off"
                className="w-full bg-[var(--panel2)] border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
              />
              <input
                type="password"
                value={loginCode}
                onChange={(e) => setLoginCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitTeamLogin()}
                placeholder="קוד אישי"
                aria-label="קוד אישי"
                autoComplete="off"
                className="w-full bg-[var(--panel2)] border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)] tracking-widest"
              />
              {authError && <div className="text-xs text-red-400 text-center">{authError}</div>}
              <button
                onClick={submitTeamLogin}
                disabled={loggingIn}
                className="w-full bg-[var(--accent)] text-[var(--accent-fg)] font-semibold rounded-xl py-2.5 text-sm disabled:opacity-60"
              >
                {loggingIn ? "נכנס…" : "כניסה"}
              </button>
              <button
                onClick={() => { setLoginMode("master"); setAuthError(""); }}
                className="w-full text-[11px] text-[var(--muted)] hover:text-[var(--text)] py-1"
              >
                כניסת מנהל עם קוד גישה ראשי
              </button>
            </>
          ) : (
            <>
              <input
                type="password"
                autoComplete="off"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitMasterLogin()}
                placeholder="קוד גישה ראשי"
                aria-label="קוד גישה ראשי"
                className="w-full bg-[var(--panel2)] border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
              />
              {authError && <div className="text-xs text-red-400 text-center">{authError}</div>}
              <button
                onClick={submitMasterLogin}
                disabled={loggingIn}
                className="w-full bg-[var(--accent)] text-[var(--accent-fg)] font-semibold rounded-xl py-2.5 text-sm disabled:opacity-60"
              >
                {loggingIn ? "נכנס…" : "כניסה"}
              </button>
              <button
                onClick={() => { setLoginMode("team"); setAuthError(""); }}
                className="w-full text-[11px] text-[var(--muted)] hover:text-[var(--text)] py-1"
              >
                → חזרה לכניסת צוות
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  if (authed === null) {
    return (
      <div data-theme={theme} className={`min-h-dvh grid place-items-center bg-[var(--bg)] text-[var(--muted)] ${fontBody.className}`} style={themeRootStyle} dir="rtl">
        <style dangerouslySetInnerHTML={{ __html: THEME_CSS }} />
        טוען…
      </div>
    );
  }

  function go(t: Tab) {
    if (t !== tab && unsavedChanges.current) {
      if (!confirm(`יש ${unsavedChanges.label || "שינויים שלא נשמרו"} במסך הנוכחי. לעזוב בלי לשמור?`)) return;
      setUnsaved(false);
    }
    setTab(t);
    setDrawerOpen(false);
  }

  /** התנתקות: מוחק את קוד הגישה מהמכשיר + את עוגיית ההתחברות, וחוזר למסך הכניסה */
  function logout() {
    if (!confirm("להתנתק מהפאנל במכשיר הזה?")) return;
    localStorage.removeItem("admin_token");
    localStorage.removeItem("agent_name");
    // מחיקת העוגייה בשרת ואז מעבר למסך הכניסה של האתר (השער החדש)
    fetch("/api/admin/logout", { method: "POST" })
      .catch(() => undefined)
      .finally(() => window.location.replace("/login"));
  }

  /** דשבורד/ידע קופצים לאינבוקס עם סינון מוכן */
  function openInbox(intent: InboxFilterIntent) {
    setInboxIntent(intent);
    go("inbox");
  }
  /** קפיצה ישירה לשיחה ספציפית */
  function openConversation(conversationId: string) {
    setInboxIntent({ conversationId });
    go("inbox");
  }
  /** ידע קופץ לבדיקת בוט עם השאלה מוכנה */
  function openTest(question: string) {
    setTestPrefill(question);
    go("test");
  }

  // במובייל, כששיחה פתוחה - מסך שיחה מלא: בלי כותרת עליונה ובלי סרגל תחתון
  const conversationOpen = tab === "inbox" && !!selectedId;

  const NavLinks = (
    <nav className="flex flex-col gap-0.5">
      {TABS.filter((t) => !(t.key === "questionnaire" && quizComplete)).map((t) => {
        const active = tab === t.key;
        return (
          <button
            key={t.key}
            onClick={() => go(t.key)}
            aria-current={active ? "page" : undefined}
            className={`relative flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-right ${
              active
                ? "bg-[color-mix(in_srgb,var(--accent)_13%,transparent)] text-[var(--accent)] font-semibold"
                : "text-[var(--muted)] hover:bg-[var(--panel2)] hover:text-[var(--text)]"
            }`}
          >
            {active && <span className="absolute right-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-full bg-[var(--accent)]" aria-hidden />}
            <TabIcon tab={t.key} />
            <span className="flex-1">{t.label}</span>
            {t.key === "inbox" && attention > 0 && (
              <span className="text-[10px] font-bold rounded-full min-w-5 h-5 px-1 grid place-items-center bg-red-500 text-white">
                {attention}
              </span>
            )}
            {t.key === "knowledge" && openQuestions > 0 && (
              <span className="text-[10px] font-bold rounded-full min-w-5 h-5 px-1 grid place-items-center bg-red-500 text-white">
                {openQuestions}
              </span>
            )}
            {t.key === "reservations" && pendingResv > 0 && (
              <span className="text-[10px] font-bold rounded-full min-w-5 h-5 px-1 grid place-items-center bg-red-500 text-white">
                {pendingResv}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );

  const SidebarFooter = (
    <div className="space-y-1.5 text-xs">
      <button
        onClick={toggleBot}
        className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl font-medium ${botEnabled ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"}`}
      >
        {botEnabled ? "● בוט פעיל" : "○ בוט כבוי"}
      </button>
      <div className="flex gap-1.5">
        <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="flex-1 px-3 py-2 rounded-xl bg-[var(--panel2)] text-[var(--muted)] hover:text-[var(--text)]">
          {theme === "dark" ? "☀ בהיר" : "☾ כהה"}
        </button>
        <button
          onClick={logout}
          className="flex-1 px-3 py-2 rounded-xl bg-[var(--panel2)] text-[var(--muted)] hover:text-red-400"
          aria-label="התנתקות מהפאנל"
        >
          ⏻ התנתק
        </button>
      </div>
    </div>
  );

  // ===== הפאנל =====
  return (
    <div
      data-theme={theme}
      className={`h-dvh overflow-hidden bg-[var(--bg)] text-[var(--text)] flex ${fontBody.className}`}
      style={{ ...themeRootStyle, height: "var(--app-h, 100dvh)" }}
      dir="rtl"
    >
      <style dangerouslySetInnerHTML={{ __html: THEME_CSS }} />

      {/* סרגל צד - דסקטופ */}
      <aside className="hidden md:flex flex-col w-60 shrink-0 border-l border-[var(--border)] bg-[var(--panel)] p-3 gap-3 h-full">
        <div className="flex items-center gap-2.5 px-1 pt-1.5 pb-2.5 border-b border-[var(--border)]">
          <BrandMark />
          <div>
            <div className={`font-bold leading-tight text-[15px] tracking-wide ${fontDisplay.className}`}>קפה קוואלי</div>
            <div className="text-[10px] text-[var(--muted)] tracking-wider">פאנל ניהול ושירות</div>
          </div>
          <button
            onClick={manualRefresh}
            disabled={syncing}
            className="ms-auto w-8 h-8 grid place-items-center rounded-xl text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--panel2)] disabled:opacity-70"
            aria-label="רענון נתונים"
            title="רענון נתונים"
          >
            {justSynced ? (
              <span className="text-emerald-500 text-sm font-bold" aria-hidden>✓</span>
            ) : (
              <RefreshIcon spinning={syncing} className="w-4 h-4" />
            )}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{NavLinks}</div>
        {SidebarFooter}
      </aside>

      {/* מגירה - מובייל ("עוד") */}
      {drawerOpen && (
        <div className="md:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
          <div className="absolute top-0 right-0 h-full w-64 bg-[var(--panel)] border-l border-[var(--border)] p-3 flex flex-col gap-3 shadow-2xl">
            <div className="flex items-center justify-between px-1">
              <div className={`font-bold flex items-center gap-2 ${fontDisplay.className}`}><BrandMark size="w-7 h-7 text-sm" /> קפה קוואלי</div>
              <button onClick={() => setDrawerOpen(false)} className="text-[var(--muted)] text-xl w-9 h-9" aria-label="סגור תפריט">×</button>
            </div>
            <div className="flex-1 overflow-y-auto">{NavLinks}</div>
            {SidebarFooter}
          </div>
        </div>
      )}

      {/* תוכן */}
      <div className="flex-1 min-w-0 flex flex-col h-full">
        {/* 🚨 אזעקת מערכת - כשל מודל/קרדיטים (מוצג לכל הצוות עד שמטופל) */}
        {alarm && (
          <div className="shrink-0 bg-red-600 text-white text-sm px-3 py-2 flex items-center gap-2 flex-wrap">
            <span className="font-bold shrink-0">🚨 תקלת מערכת:</span>
            <span className="flex-1 min-w-48">
              {alarm.reason === "credit"
                ? "נגמרו הקרדיטים של Anthropic - הבוט לא מצליח לענות ללקוחות! לטעינה מיידית: console.anthropic.com ← Billing"
                : "הבוט נתקל בשגיאות מול המודל - חלק מהלקוחות מקבלים הודעת תקלה. אם זה נמשך כמה דקות, בדקו את יתרת הקרדיטים."}
              <span className="text-white/75 text-xs mr-1.5">
                ({new Date(alarm.ts).toLocaleTimeString("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" })})
              </span>
            </span>
            <button onClick={clearAlarm} className="shrink-0 text-xs bg-white/20 rounded-lg px-2.5 py-1 hover:bg-white/30">
              טופל - הסר
            </button>
          </div>
        )}
        {/* באנר ניתוק */}
        {offline && (
          <div className="shrink-0 bg-red-500/15 text-red-300 border-b border-red-500/30 text-xs text-center py-1.5 px-3">
            אין חיבור לשרת - הנתונים עלולים להיות לא מעודכנים. מנסים להתחבר מחדש…
          </div>
        )}

        {/* גלאי ערוץ שקט: שקט חריג בשעות פעילות = ייתכן נתק בערוצי ההודעות */}
        {quietAlert !== null && !offline && (
          <div className="shrink-0 bg-amber-500/15 text-amber-300 border-b border-amber-500/30 text-xs text-center py-1.5 px-3">
            ⚠️ לא התקבלה אף הודעת לקוח כבר {quietAlert} שעות בשעות הפעילות - ייתכן נתק בערוצים. בדקו
            "חיבור הערוצים" בהגדרות, ואם הכל ירוק - נסו לשלוח הודעת בדיקה לעמוד.
          </div>
        )}

        {/* סרגל עליון - מובייל (מוסתר כששיחה פתוחה). בלי backdrop-blur - יקר ל-GPU של הטלפון */}
        {!conversationOpen && (
          <header className="md:hidden shrink-0 bg-[var(--bg)] border-b border-[var(--border)] px-3 py-2.5 flex items-center gap-3">
            <span className="font-bold flex-1">{TABS.find((t) => t.key === tab)?.label}</span>
            {!botEnabled && <span className="text-[10px] bg-red-500/15 text-red-400 rounded-full px-2 py-0.5">בוט כבוי</span>}
            {/* רענון ידני: חיוני במצב אפליקציה מותקנת - אין שם כפתור רענון של דפדפן */}
            <button
              onClick={manualRefresh}
              disabled={syncing}
              className="w-9 h-9 -my-1.5 grid place-items-center rounded-xl text-[var(--muted)] hover:text-[var(--text)] active:bg-[var(--panel2)] disabled:opacity-70"
              aria-label="רענון נתונים"
              title="רענון נתונים"
            >
              {justSynced ? (
                <span className="text-emerald-500 font-bold" aria-hidden>✓</span>
              ) : (
                <RefreshIcon spinning={syncing} />
              )}
            </button>
            {attention > 0 && tab !== "inbox" && (
              <button onClick={() => go("inbox")} className="bg-red-500 text-white text-xs rounded-full min-w-5 h-5 px-1.5 grid place-items-center" aria-label={`${attention} שיחות ממתינות`}>
                {attention}
              </button>
            )}
          </header>
        )}

        <main className={`flex-1 min-h-0 ${tab === "inbox" ? "overflow-hidden p-0 md:p-4" : "overflow-y-auto p-3 md:p-5"}`}>
          {tab === "inbox" && (
            <Inbox
              token={token}
              agentName={agentName}
              conversations={conversations}
              loaded={convsLoaded}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
              onMutate={loadConversations}
              templates={templates}
              intent={inboxIntent}
              onIntentConsumed={() => setInboxIntent(null)}
            />
          )}
          {tab !== "inbox" && (
            // key=refreshTick: רענון ידני מרכיב את המסך מחדש - כמו יציאה וחזרה
            // לטאב - כך שכל מסך באמת מושך נתונים טריים, לא רק מסובב אייקון
            <div key={refreshTick} className="max-w-[1700px] mx-auto">
              <header className="hidden md:block mb-5">
                <h1 className={`text-[22px] font-bold ${fontDisplay.className}`}>{TAB_META[tab].title}</h1>
                <p className="text-[13px] text-[var(--muted)] mt-0.5">{TAB_META[tab].subtitle}</p>
              </header>
          {tab === "reservations" && (
            <Reservations token={token} agentName={agentName} onOpenConversation={openConversation} />
          )}
          {tab === "knowledge" && (
            <Knowledge token={token} onMutate={loadConversations} onTest={openTest} onOpenConversation={openConversation} agentName={agentName} />
          )}
          {tab === "questionnaire" && <Questionnaire token={token} agentName={agentName} />}
          {tab === "dashboard" && <Dashboard token={token} onOpenInbox={openInbox} onOpenKnowledge={() => go("knowledge")} onOpenReservations={() => go("reservations")} />}
          {tab === "business" && <BusinessEditor token={token} />}
          {tab === "media" && <Media token={token} />}
          {tab === "test" && <TestChat prefill={testPrefill} onPrefillConsumed={() => setTestPrefill(null)} />}
          {tab === "settings" && (
            <Settings
              token={token}
              isMaster={role === "master"}
              agentName={agentName}
              setAgentName={setAgentName}
              notify={notify}
              setNotify={setNotify}
              voice={voice}
              setVoice={setVoice}
              botEnabled={botEnabled}
              onToggleBot={toggleBot}
              onLogout={logout}
            />
          )}
            </div>
          )}
        </main>

        {/* ניווט תחתון - מובייל (מוסתר כששיחה פתוחה, כדי לפנות מקום להקלדה) */}
        {!conversationOpen && (
          <nav
            className="md:hidden shrink-0 bg-[var(--panel)] border-t border-[var(--border)] flex items-stretch pb-[env(safe-area-inset-bottom)]"
            aria-label="ניווט ראשי"
          >
            {BOTTOM_TABS.map((key) => {
              const t = TABS.find((x) => x.key === key)!;
              const active = tab === key;
              return (
                <button
                  key={key}
                  onClick={() => go(key)}
                  aria-current={active ? "page" : undefined}
                  className={`flex-1 flex flex-col items-center gap-0.5 py-2 min-h-12 relative ${active ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}
                >
                  <span className="relative">
                    <TabIcon tab={key} className="w-5 h-5" />
                    {key === "inbox" && attention > 0 && (
                      <span className="absolute -top-1 -left-3 bg-red-500 text-white text-[9px] rounded-full min-w-4 h-4 px-0.5 grid place-items-center">
                        {attention}
                      </span>
                    )}
                    {key === "knowledge" && openQuestions > 0 && (
                      <span className="absolute -top-1 -left-3 bg-red-500 text-white text-[9px] rounded-full min-w-4 h-4 px-0.5 grid place-items-center">
                        {openQuestions}
                      </span>
                    )}
                    {key === "reservations" && pendingResv > 0 && (
                      <span className="absolute -top-1 -left-3 bg-red-500 text-white text-[9px] rounded-full min-w-4 h-4 px-0.5 grid place-items-center">
                        {pendingResv}
                      </span>
                    )}
                  </span>
                  <span className="text-[10px] font-medium">{t.label}</span>
                </button>
              );
            })}
            <button
              onClick={() => setDrawerOpen(true)}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2 min-h-12 ${!BOTTOM_TABS.includes(tab) ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}
              aria-label="עוד מסכים"
            >
              <span className="text-lg leading-none">☰</span>
              <span className="text-[10px] font-medium">עוד</span>
            </button>
          </nav>
        )}
      </div>
    </div>
  );
}
