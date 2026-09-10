"use client";

import { useState } from "react";
import Tabit from "./Tabit";
import TabitTestChat from "./TabitTestChat";
import FloorMap from "./FloorMap";
import Revenue from "./Revenue";

/**
 * מרכז טאביט - טאב אחד שמאחד את כל תת-התצוגות (שלב 1, קריאה בלבד):
 * יום (הזמנות + עומס), מפת רצפה חיה, הכנסות, ומעבדת הצ'אט. כל תת-תצוגה מנהלת
 * את הריענון שלה בעצמה. פעולות כתיבה מושבתות בשרת ובסוכן (ראה testchat/agent).
 */

const VIEWS = [
  { key: "day", label: "יום" },
  { key: "floor", label: "מפת רצפה" },
  { key: "revenue", label: "הכנסות" },
  { key: "lab", label: "מעבדה" },
] as const;
type ViewKey = (typeof VIEWS)[number]["key"];

export default function TabitHub({ token, agentName }: { token: string; agentName?: string }) {
  const [view, setView] = useState<ViewKey>(() => {
    try {
      const v = localStorage.getItem("tabit_hub_view");
      if (v && VIEWS.some((x) => x.key === v)) return v as ViewKey;
    } catch {}
    return "day";
  });
  function pick(v: ViewKey) {
    setView(v);
    try {
      localStorage.setItem("tabit_hub_view", v);
    } catch {}
  }

  return (
    <div className="space-y-4">
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

      {view === "day" && <Tabit token={token} agentName={agentName} />}
      {view === "floor" && <FloorMap token={token} />}
      {view === "revenue" && <Revenue token={token} />}
      {view === "lab" && <TabitTestChat token={token} />}
    </div>
  );
}
