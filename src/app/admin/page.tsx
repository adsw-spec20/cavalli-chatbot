"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ConvItem, type QuickReply } from "./types";
import { unsavedChanges, setUnsaved } from "./dirty";
import Inbox, { type InboxFilterIntent } from "./Inbox";
import Dashboard from "./Dashboard";
import Knowledge from "./Knowledge";
import BusinessEditor from "./BusinessEditor";
import Settings from "./Settings";
import Media from "./Media";
import TestChat from "./TestChat";

const THEME_CSS = `
[data-theme="dark"]{--bg:#0e0f13;--panel:#16181d;--panel2:#1d2026;--border:#2a2e37;--text:#e9eaed;--muted:#9aa0ac;--accent:#d4af37;--accent-fg:#1a1206;}
[data-theme="light"]{--bg:#f5f6f8;--panel:#ffffff;--panel2:#eef1f5;--border:#e2e6ec;--text:#1a1d23;--muted:#6b7280;--accent:#b07d1a;--accent-fg:#ffffff;}
.no-scrollbar::-webkit-scrollbar{display:none}.no-scrollbar{scrollbar-width:none}
`;

type Tab = "inbox" | "knowledge" | "dashboard" | "business" | "media" | "test" | "settings";
// הסדר לפי תדירות שימוש: פניות -> לימוד הבוט -> נתונים -> תחזוקה
const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "inbox", label: "תיבת פניות", icon: "📥" },
  { key: "knowledge", label: "ידע", icon: "🧠" },
  { key: "dashboard", label: "דשבורד", icon: "📊" },
  { key: "business", label: "מידע עסקי", icon: "🏪" },
  { key: "media", label: "מדיה", icon: "🖼️" },
  { key: "test", label: "בדיקת בוט", icon: "🧪" },
  { key: "settings", label: "הגדרות", icon: "⚙️" },
];
/** הטאבים שמופיעים בסרגל התחתון במובייל (התדירים ביותר) */
const BOTTOM_TABS: Tab[] = ["inbox", "knowledge", "dashboard"];

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

  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [tab, setTab] = useState<Tab>("inbox");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [notify, setNotify] = useState(false);
  const [voice, setVoice] = useState(false);

  const [conversations, setConversations] = useState<ConvItem[]>([]);
  const [convsLoaded, setConvsLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<QuickReply[]>([]);
  const [botEnabled, setBotEnabled] = useState(true);
  const knownEscalations = useRef<Set<string>>(new Set());
  const pollFailures = useRef(0);
  const [offline, setOffline] = useState(false);

  // כוונות ניווט בין מסכים (דשבורד -> אינבוקס מסונן, ידע -> בדיקת בוט)
  const [inboxIntent, setInboxIntent] = useState<InboxFilterIntent | null>(null);
  const [testPrefill, setTestPrefill] = useState<string | null>(null);

  useEffect(() => {
    setToken(localStorage.getItem("admin_token") || "");
    setTheme((localStorage.getItem("admin_theme") as "dark" | "light") || "dark");
    setAgentName(localStorage.getItem("agent_name") || "");
    setVoice(localStorage.getItem("admin_voice") === "1");
    setNotify(typeof Notification !== "undefined" && Notification.permission === "granted");
    if (!localStorage.getItem("admin_token")) setAuthed(false);
  }, []);

  useEffect(() => localStorage.setItem("admin_theme", theme), [theme]);
  useEffect(() => localStorage.setItem("agent_name", agentName), [agentName]);
  useEffect(() => localStorage.setItem("admin_voice", voice ? "1" : "0"), [voice]);

  // גובה אמיתי של אזור התצוגה: כשמקלדת המובייל נפתחת, ה-visual viewport מתכווץ
  // אבל dvh לא (iOS). מעדכנים משתנה CSS כדי ששדה ההקלדה יישאר מעל המקלדת.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      if (vv.scale > 1.01) return; // בזום ידני לא נוגעים בפריסה
      document.documentElement.style.setProperty("--app-h", `${vv.height}px`);
    };
    update();
    vv.addEventListener("resize", update);
    return () => vv.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (!token) return;
    api<{ botEnabled: boolean }>(token, "/settings")
      .then((s) => {
        setAuthed(true);
        setAuthError("");
        setBotEnabled(s.botEnabled);
        localStorage.setItem("admin_token", token);
      })
      .catch((e) => {
        setAuthed(false);
        setAuthError(e instanceof Error && e.message === "unauthorized" ? "קוד גישה שגוי" : "לא ניתן להתחבר לשרת");
      });
  }, [token]);

  const loadConversations = useCallback(async () => {
    if (!token) return;
    try {
      const list = await api<ConvItem[]>(token, "/conversations");
      setConversations(list);
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
    const t = setInterval(loadConversations, 4000);
    return () => clearInterval(t);
  }, [authed, loadConversations]);

  useEffect(() => {
    if (!authed) return;
    api<QuickReply[]>(token, "/templates").then(setTemplates).catch(() => {});
  }, [authed, token, tab]);

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

  // ===== מסך התחברות =====
  if (authed === false) {
    return (
      <div data-theme={theme} className="min-h-dvh grid place-items-center bg-[var(--bg)] text-[var(--text)] p-4" dir="rtl">
        <style dangerouslySetInnerHTML={{ __html: THEME_CSS }} />
        <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-6 w-full max-w-sm space-y-3">
          <div className="text-center">
            <div className="text-2xl font-bold tracking-tight">קפה קוואלי</div>
            <div className="text-xs text-[var(--muted)]">פאנל ניהול ושירות</div>
          </div>
          <input
            type="password"
            autoComplete="off"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && tokenInput.trim() && (setAuthed(null), setToken(tokenInput.trim()))}
            placeholder="קוד גישה"
            aria-label="קוד גישה לפאנל"
            className="w-full bg-[var(--panel2)] border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
          />
          {authError && <div className="text-xs text-red-400 text-center">{authError}</div>}
          <button
            onClick={() => tokenInput.trim() && (setAuthed(null), setToken(tokenInput.trim()))}
            className="w-full bg-[var(--accent)] text-[var(--accent-fg)] font-semibold rounded-xl py-2.5 text-sm"
          >
            כניסה
          </button>
        </div>
      </div>
    );
  }

  if (authed === null) {
    return (
      <div data-theme={theme} className="min-h-dvh grid place-items-center bg-[var(--bg)] text-[var(--muted)]" dir="rtl">
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

  /** דשבורד/ידע קופצים לאינבוקס עם סינון מוכן */
  function openInbox(intent: InboxFilterIntent) {
    setInboxIntent(intent);
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
    <nav className="flex flex-col gap-1">
      {TABS.map((t) => (
        <button
          key={t.key}
          onClick={() => go(t.key)}
          aria-current={tab === t.key ? "page" : undefined}
          className={`relative flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition text-right ${
            tab === t.key ? "bg-[var(--accent)] text-[var(--accent-fg)] font-semibold" : "text-[var(--muted)] hover:bg-[var(--panel2)] hover:text-[var(--text)]"
          }`}
        >
          <span className="text-base">{t.icon}</span>
          <span className="flex-1">{t.label}</span>
          {t.key === "inbox" && attention > 0 && (
            <span className={`text-[10px] rounded-full min-w-5 h-5 px-1 grid place-items-center ${tab === t.key ? "bg-[var(--accent-fg)] text-[var(--accent)]" : "bg-red-500 text-white"}`}>
              {attention}
            </span>
          )}
        </button>
      ))}
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
      </div>
    </div>
  );

  // ===== הפאנל =====
  return (
    <div
      data-theme={theme}
      className="h-dvh overflow-hidden bg-[var(--bg)] text-[var(--text)] flex"
      style={{ height: "var(--app-h, 100dvh)" }}
      dir="rtl"
    >
      <style dangerouslySetInnerHTML={{ __html: THEME_CSS }} />

      {/* סרגל צד - דסקטופ */}
      <aside className="hidden md:flex flex-col w-56 shrink-0 border-l border-[var(--border)] bg-[var(--panel)] p-3 gap-3 h-full">
        <div className="flex items-center gap-2 px-1 py-1">
          <div className="w-8 h-8 rounded-lg bg-[var(--accent)] text-[var(--accent-fg)] grid place-items-center font-bold">C</div>
          <div>
            <div className="font-bold leading-tight">קפה קוואלי</div>
            <div className="text-[10px] text-[var(--muted)]">פאנל ניהול</div>
          </div>
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
              <div className="font-bold">קפה קוואלי</div>
              <button onClick={() => setDrawerOpen(false)} className="text-[var(--muted)] text-xl w-9 h-9" aria-label="סגור תפריט">×</button>
            </div>
            <div className="flex-1 overflow-y-auto">{NavLinks}</div>
            {SidebarFooter}
          </div>
        </div>
      )}

      {/* תוכן */}
      <div className="flex-1 min-w-0 flex flex-col h-full">
        {/* באנר ניתוק */}
        {offline && (
          <div className="shrink-0 bg-red-500/15 text-red-300 border-b border-red-500/30 text-xs text-center py-1.5 px-3">
            אין חיבור לשרת - הנתונים עלולים להיות לא מעודכנים. מנסים להתחבר מחדש…
          </div>
        )}

        {/* סרגל עליון - מובייל (מוסתר כששיחה פתוחה) */}
        {!conversationOpen && (
          <header className="md:hidden shrink-0 bg-[var(--bg)]/95 backdrop-blur border-b border-[var(--border)] px-3 py-2.5 flex items-center gap-3">
            <span className="font-bold flex-1">{TABS.find((t) => t.key === tab)?.label}</span>
            {!botEnabled && <span className="text-[10px] bg-red-500/15 text-red-400 rounded-full px-2 py-0.5">בוט כבוי</span>}
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
          {tab === "knowledge" && <Knowledge token={token} onMutate={loadConversations} onTest={openTest} />}
          {tab === "dashboard" && <Dashboard token={token} onOpenInbox={openInbox} onOpenKnowledge={() => go("knowledge")} />}
          {tab === "business" && <BusinessEditor token={token} />}
          {tab === "media" && <Media token={token} />}
          {tab === "test" && <TestChat prefill={testPrefill} onPrefillConsumed={() => setTestPrefill(null)} />}
          {tab === "settings" && (
            <Settings
              token={token}
              agentName={agentName}
              setAgentName={setAgentName}
              notify={notify}
              setNotify={setNotify}
              voice={voice}
              setVoice={setVoice}
              botEnabled={botEnabled}
              onToggleBot={toggleBot}
              onLogout={() => { localStorage.removeItem("admin_token"); setToken(""); setAuthed(false); }}
            />
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
                  <span className="text-lg leading-none relative">
                    {t.icon}
                    {key === "inbox" && attention > 0 && (
                      <span className="absolute -top-1 -left-3 bg-red-500 text-white text-[9px] rounded-full min-w-4 h-4 px-0.5 grid place-items-center">
                        {attention}
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
