"use client";

import { useEffect, useState } from "react";
import { api, CHANNELS, relTime, type QuickReply, type ChannelHealth } from "./types";

export default function Settings({
  token,
  agentName,
  setAgentName,
  notify,
  setNotify,
  voice,
  setVoice,
  botEnabled,
  onToggleBot,
  onLogout,
}: {
  token: string;
  agentName: string;
  setAgentName: (v: string) => void;
  notify: boolean;
  setNotify: (v: boolean) => void;
  voice: boolean;
  setVoice: (v: boolean) => void;
  botEnabled: boolean;
  onToggleBot: () => void;
  onLogout: () => void;
}) {
  const [templates, setTemplates] = useState<QuickReply[]>([]);
  const [health, setHealth] = useState<ChannelHealth[]>([]);
  const [saved, setSaved] = useState(false);
  const [saveErr, setSaveErr] = useState("");

  useEffect(() => {
    api<QuickReply[]>(token, "/templates").then(setTemplates).catch(() => {});
    api<ChannelHealth[]>(token, "/health").then(setHealth).catch(() => {});
  }, [token]);

  async function saveTemplates(next: QuickReply[]) {
    setTemplates(next);
    setSaveErr("");
    try {
      await api(token, "/templates", { method: "PUT", body: JSON.stringify(next) });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "שמירה נכשלה");
    }
  }

  async function enableNotify() {
    if (!("Notification" in window)) return;
    const p = await Notification.requestPermission();
    setNotify(p === "granted");
  }

  return (
    <div className="space-y-5 max-w-2xl">
      {/* בריאות הערוצים */}
      <section className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-4">
        <h3 className="font-semibold text-sm mb-2">חיבור הערוצים</h3>
        {health.length === 0 && <div className="text-xs text-[var(--muted)]">טוען מצב ערוצים…</div>}
        <div className="space-y-2">
          {health.map((h) => (
            <div key={h.channel} className="flex items-center justify-between text-sm gap-2">
              <span className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${h.configured ? "bg-emerald-500" : "bg-neutral-500"}`} aria-hidden />
                {CHANNELS[h.channel]?.label ?? h.channel}
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${h.configured ? "bg-emerald-500/10 text-emerald-400" : "bg-neutral-500/10 text-neutral-400"}`}>
                  {h.configured ? "מחובר" : "לא מחובר"}
                </span>
              </span>
              <span className="text-xs text-[var(--muted)] text-left">
                {h.configured ? (h.lastInbound ? `הודעת לקוח אחרונה: ${relTime(h.lastInbound)}` : "אין הודעות נכנסות עדיין") : "חסרים פרטי חיבור (env)"}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* הבוט */}
      <section className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-sm">מתג ראשי לבוט</h3>
            <p className="text-xs text-[var(--muted)]">כשהבוט כבוי, אף לקוח לא מקבל מענה אוטומטי בשום ערוץ - רק נציגים עונים.</p>
          </div>
          <button
            onClick={() => {
              if (botEnabled && !confirm("לכבות את הבוט לכל הלקוחות בכל הערוצים?")) return;
              onToggleBot();
            }}
            className={`shrink-0 text-xs rounded-lg px-3 py-2 font-semibold ${botEnabled ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"}`}
          >
            {botEnabled ? "● פעיל" : "○ כבוי"}
          </button>
        </div>
      </section>

      {/* שם הנציג */}
      <section className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-4">
        <h3 className="font-semibold text-sm mb-1">שם הנציג שלך</h3>
        <p className="text-xs text-[var(--muted)] mb-2">יופיע ליד התשובות שאתה שולח, כדי שהצוות ידע מי ענה.</p>
        <input
          value={agentName}
          onChange={(e) => setAgentName(e.target.value)}
          placeholder="לדוגמה: איתי"
          className="bg-[var(--panel2)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm outline-none focus:border-[var(--accent)] w-48"
        />
      </section>

      {/* התראות */}
      <section className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-sm">התראות דפדפן</h3>
            <p className="text-xs text-[var(--muted)]">התראה כשמגיעה הסלמה חדשה.</p>
          </div>
          {notify ? (
            <span className="text-xs text-emerald-400">פעיל ✓</span>
          ) : (
            <button onClick={enableNotify} className="text-xs bg-[var(--accent)] text-[var(--accent-fg)] rounded-lg px-3 py-1.5 font-semibold">
              הפעל
            </button>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-[var(--border)] pt-3">
          <div>
            <h3 className="font-semibold text-sm">צליל התראה</h3>
            <p className="text-xs text-[var(--muted)]">השמע צליל כשמגיעה הסלמה חדשה.</p>
          </div>
          <button
            onClick={() => setVoice(!voice)}
            className={`text-xs rounded-lg px-3 py-1.5 font-semibold ${voice ? "bg-emerald-500/15 text-emerald-400" : "bg-[var(--panel2)] text-[var(--muted)]"}`}
          >
            {voice ? "פעיל ✓" : "כבוי"}
          </button>
        </div>
      </section>

      {/* תבניות תשובה מהירות */}
      <section className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-4">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold text-sm">תשובות מהירות</h3>
          {saved && <span className="text-xs text-emerald-400">נשמר ✓</span>}
          {saveErr && <span className="text-xs text-red-400">⚠ {saveErr}</span>}
        </div>
        <p className="text-xs text-[var(--muted)] mb-3">תבניות ללחיצה אחת בתוך שיחה (למשל "שעות פתיחה", "מספר טלפון").</p>
        <div className="space-y-2">
          {templates.map((t, i) => (
            <div key={i} className="flex gap-2 items-start">
              <input
                value={t.title}
                onChange={(e) => {
                  const next = [...templates];
                  next[i] = { ...t, title: e.target.value };
                  setTemplates(next);
                }}
                onBlur={() => saveTemplates(templates)}
                placeholder="כותרת"
                className="w-28 shrink-0 bg-[var(--panel2)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-xs outline-none"
              />
              <textarea
                value={t.text}
                onChange={(e) => {
                  const next = [...templates];
                  next[i] = { ...t, text: e.target.value };
                  setTemplates(next);
                }}
                onBlur={() => saveTemplates(templates)}
                rows={1}
                placeholder="טקסט התשובה"
                className="flex-1 bg-[var(--panel2)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-xs outline-none resize-none"
              />
              <button onClick={() => saveTemplates(templates.filter((_, j) => j !== i))} className="text-[var(--muted)] hover:text-red-400 px-1 py-1.5">
                ×
              </button>
            </div>
          ))}
        </div>
        <button onClick={() => setTemplates([...templates, { title: "", text: "" }])} className="mt-2 text-xs text-[var(--accent)] hover:underline">
          + הוסף תבנית
        </button>
      </section>

      {/* אזור מסוכן */}
      <section className="bg-[var(--panel)] border border-red-500/25 rounded-2xl p-4">
        <h3 className="font-semibold text-sm mb-1 text-red-400">אזור מסוכן</h3>
        <p className="text-xs text-[var(--muted)] mb-2">התנתקות תמחק את קוד הגישה מהמכשיר הזה.</p>
        <button
          onClick={() => confirm("להתנתק מהפאנל במכשיר הזה?") && onLogout()}
          className="text-xs text-red-400 border border-red-500/30 rounded-lg px-3 py-1.5 hover:bg-red-500/10"
        >
          התנתק מהפאנל
        </button>
      </section>
    </div>
  );
}
