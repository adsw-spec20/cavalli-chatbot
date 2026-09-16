"use client";

import { useEffect, useState } from "react";
import { api } from "./types";
import Tabit from "./Tabit";
import TabitTestChat from "./TabitTestChat";
import FloorMap from "./FloorMap";
import TabitGuide from "./TabitGuide";

/**
 * מרכז טאביט - טאב אחד שמאחד את כל תת-התצוגות (שלב 1, קריאה בלבד):
 * יום (הזמנות + עומס), מפת רצפה חיה, ומעבדת הצ'אט. כל תת-תצוגה מנהלת
 * את הריענון שלה בעצמה. פעולות כתיבה מושבתות בשרת ובסוכן (ראה testchat/agent).
 * נפתח לכל הצוות (15.9); היסטוריית המעבדה ומחיקתה נשארו למנהל בלבד (isMaster).
 * (לשונית ההכנסות הוסרה לבקשת המנהל 15.9 - הקומפוננטה Revenue.tsx וה-API נשארו לשחזור עתידי.)
 */

const VIEWS = [
  { key: "day", label: "יום" },
  { key: "floor", label: "מפת רצפה" },
  { key: "lab", label: "מעבדה" },
] as const;
type ViewKey = (typeof VIEWS)[number]["key"];

export default function TabitHub({ token, agentName, isMaster }: { token: string; agentName?: string; isMaster?: boolean }) {
  const [view, setView] = useState<ViewKey>(() => {
    try {
      const v = localStorage.getItem("tabit_hub_view");
      if (v && VIEWS.some((x) => x.key === v)) return v as ViewKey;
    } catch {}
    return "day";
  });
  // המדריך נפתח כשכבה מעל התצוגה הנוכחית - והנושא שלו עוקב אחרי הלשונית הפעילה
  const [guideOpen, setGuideOpen] = useState(false);

  // דופק הסוכן: אם ה-snapshot לא התעדכן הרבה זמן - פס אזהרה אדום בראש המסך
  // (הסוכן דוחף כל ~5 דק'; 15+ דק' = שלושה מחזורים שהוחמצו = כנראה נפל).
  // נבדק כל 30 שנ' + מיד בכל חזרה לטאב - כדי שהפס יופיע לבד, בלי רענון (דווח 16.9).
  const [agentDownMin, setAgentDownMin] = useState<number | null>(null);
  useEffect(() => {
    let stop = false;
    const check = async () => {
      try {
        const d = await api<{ generatedAt: number | null; ageMinutes: number | null }>(token, "/tabit/status");
        if (stop) return;
        setAgentDownMin(d.generatedAt && d.ageMinutes != null && d.ageMinutes >= 15 ? d.ageMinutes : null);
      } catch { /* לא חוסמים את המסך בגלל בדיקת דופק */ }
    };
    check();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") check();
    }, 30_000);
    const onWake = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onWake);
    return () => { stop = true; clearInterval(t); document.removeEventListener("visibilitychange", onWake); };
  }, [token]);
  function pick(v: ViewKey) {
    setView(v);
    try {
      localStorage.setItem("tabit_hub_view", v);
    } catch {}
  }

  return (
    <div className="space-y-4">
      {agentDownMin != null && (
        // sticky: הפס נשאר צמוד לראש המסך גם כשגוללים למטה (רקע אטום כדי שלא ישקף תוכן)
        <div
          className="sticky top-0 z-30 rounded-xl border-2 border-red-500/60 text-red-600 px-4 py-2.5 text-sm font-semibold flex items-center gap-2 flex-wrap shadow-lg"
          style={{ background: "color-mix(in srgb, #ef4444 10%, var(--bg))" }}
        >
          <span aria-hidden>🔴</span>
          <span>
            הסוכן של טאביט לא מדווח כבר {agentDownMin >= 60 ? `${Math.floor(agentDownMin / 60)} ש' ו-${agentDownMin % 60} דק'` : `${agentDownMin} דק'`} -
            הנתונים במסך הזה לא מתעדכנים.
          </span>
          <span className="font-normal text-[13px] opacity-90">בדקו שהמחשב במסעדה דלוק ושהסוכן (agent) רץ.</span>
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-xl border border-[var(--border)] overflow-hidden flex-wrap">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              onClick={() => pick(v.key)}
              aria-current={view === v.key ? "page" : undefined}
              className={`px-4 py-2 text-sm ${
                view === v.key ? "bg-[var(--accent)] text-[var(--accent-fg)] font-semibold" : "text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setGuideOpen((g) => !g)}
          aria-pressed={guideOpen}
          title="מדריך קצר על המסך הנוכחי"
          className={`rounded-xl border px-3.5 py-2 text-sm transition ${
            guideOpen
              ? "bg-[var(--accent)] text-[var(--accent-fg)] border-transparent font-semibold"
              : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
          }`}
        >
          📖 מדריך
        </button>
      </div>

      {guideOpen ? (
        <TabitGuide topic={view} onClose={() => setGuideOpen(false)} />
      ) : (
        <>
          {view === "day" && <Tabit token={token} agentName={agentName} />}
          {view === "floor" && <FloorMap token={token} />}
          {view === "lab" && <TabitTestChat token={token} isMaster={isMaster} />}
        </>
      )}
    </div>
  );
}
