"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type BusinessConfig } from "./types";
import { setUnsaved } from "./dirty";

/**
 * עורך המידע העסקי.
 *
 * מבנה (שוכתב 30.8): במקום ערימת אקורדיונים בשתי עמודות - ארבעה מסכים ממוקדים,
 * מסודרים לפי תדירות השימוש. מה שמעדכנים כל שבוע (שעות, תאריכים מיוחדים, תפריט)
 * בחזית; מה שנוגעים בו פעם בשנה (תיאור, טון, ברכה) אחרון. עורך התפריט מקופל
 * לפי קטגוריות עם חיפוש, כי 116 מנות בפריסה מלאה היו בלתי-שמישות בטלפון.
 */

const inputCls =
  "w-full bg-[var(--panel2)] border border-[var(--border)] rounded-lg px-2.5 py-2 text-sm outline-none focus:border-[var(--accent)]";

function Field({
  label,
  value,
  onChange,
  area,
  rows = 3,
  hint,
  placeholder,
}: {
  label: string;
  value?: string;
  onChange: (v: string) => void;
  area?: boolean;
  rows?: number;
  hint?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-[var(--muted)] mb-1 block">{label}</span>
      {area ? (
        <textarea
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          placeholder={placeholder}
          className={`${inputCls} leading-relaxed`}
        />
      ) : (
        <input value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={inputCls} />
      )}
      {hint && <span className="text-[11px] text-[var(--muted)] mt-1 block">{hint}</span>}
    </label>
  );
}

/** כרטיס תוכן פשוט - החליף את האקורדיונים */
function Block({ title, sub, children, actions }: { title: string; sub?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl overflow-hidden">
      <header className="px-4 pt-3.5 pb-2.5 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-sm font-display">{title}</h3>
          {sub && <p className="text-[11px] text-[var(--muted)] mt-0.5 leading-snug">{sub}</p>}
        </div>
        {actions}
      </header>
      <div className="px-4 pb-4 space-y-3">{children}</div>
    </section>
  );
}

/** בחירת צ'יפים ממאגר קבוע (תגיות תזונה / אלרגנים) */
function ChipPicker({
  label,
  presets,
  selected,
  onChange,
  danger,
}: {
  label: string;
  presets: string[];
  selected: string[];
  onChange: (v: string[] | undefined) => void;
  danger?: boolean;
}) {
  const toggle = (p: string) => {
    const next = selected.includes(p) ? selected.filter((x) => x !== p) : [...selected, p];
    onChange(next.length ? next : undefined);
  };
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[10px] text-[var(--muted)] ml-1">{label}:</span>
      {presets.map((p) => {
        const on = selected.includes(p);
        return (
          <button
            key={p}
            onClick={() => toggle(p)}
            className={`text-[10px] rounded-full px-2 py-1 border transition ${
              on
                ? danger
                  ? "bg-red-500/15 text-red-400 border-red-500/40"
                  : "bg-[var(--accent)]/15 text-[var(--accent)] border-[var(--accent)]/40"
                : "text-[var(--muted)] border-[var(--border)] hover:text-[var(--text)]"
            }`}
          >
            {on ? "✓ " : ""}
            {p}
          </button>
        );
      })}
    </div>
  );
}

const HE_WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
function weekdayHe(dateISO: string): string | null {
  const [y, m, d] = dateISO.split("-").map(Number);
  if (!y || !m || !d) return null;
  return HE_WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
function todayILStr(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

const DIET_TAGS = ["צמחוני", "טבעוני", "ללא גלוטן", "חריף", "פופולרי", "לילדים"];
const ALLERGENS = ["גלוטן", "חלב", "ביצים", "אגוזים", "בוטנים", "שומשום", "דגים", "סויה"];

function StringList({ items, onChange, placeholder }: { items: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  return (
    <div className="space-y-1.5">
      {items.map((it, i) => (
        <div key={i} className="flex gap-2 items-start">
          <textarea
            value={it}
            rows={2}
            onChange={(e) => {
              const next = [...items];
              next[i] = e.target.value;
              onChange(next);
            }}
            className={`${inputCls} text-xs leading-relaxed`}
          />
          <button
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            aria-label="מחיקה"
            className="shrink-0 w-8 h-8 grid place-items-center rounded-lg text-[var(--muted)] hover:text-red-400 hover:bg-red-500/10 text-lg leading-none"
          >
            ×
          </button>
        </div>
      ))}
      <button onClick={() => onChange([...items, ""])} className="text-xs text-[var(--accent)] font-semibold hover:underline">
        + {placeholder}
      </button>
    </div>
  );
}

type TabKey = "hours" | "menu" | "policies" | "profile";
const TABS: { key: TabKey; label: string; icon: string; sub: string }[] = [
  { key: "hours", label: "שעות ותאריכים", icon: "🕐", sub: "שעות קבועות, ערבי חג וסגירות מיוחדות, הקרנות" },
  { key: "menu", label: "תפריט", icon: "🍽️", sub: "מנות, מחירים, ומה אזל כרגע" },
  { key: "policies", label: "מדיניות ושאלות", icon: "📋", sub: "שאלות נפוצות, נהלים, מתקנים, חניה" },
  { key: "profile", label: "פרטי העסק", icon: "🏠", sub: "שם, תיאור, טון הדיבור ופרטי קשר - נוגעים בזה לעיתים רחוקות" },
];

export default function BusinessEditor({ token }: { token: string }) {
  const [cfg, setCfg] = useState<BusinessConfig | null>(null);
  const [def, setDef] = useState<BusinessConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [tab, setTab] = useState<TabKey>("hours");
  const [menuQuery, setMenuQuery] = useState("");
  const [openCats, setOpenCats] = useState<Set<number>>(new Set());
  const [openItems, setOpenItems] = useState<Set<string>>(new Set());
  const savedSnapshot = useRef("");
  const dirty = !!cfg && JSON.stringify(cfg) !== savedSnapshot.current;

  useEffect(() => {
    api<{ config: BusinessConfig; default: BusinessConfig }>(token, "/business-config")
      .then((d) => {
        savedSnapshot.current = JSON.stringify(d.config);
        setCfg(d.config);
        setDef(d.default);
      })
      .catch((e) => setMsg(e instanceof Error ? e.message : "שגיאה"));
  }, [token]);

  useEffect(() => {
    setUnsaved(dirty, "שינויים במידע העסקי שלא נשמרו");
    return () => setUnsaved(false);
  }, [dirty]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (JSON.stringify(cfg) !== savedSnapshot.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [cfg]);

  const q = menuQuery.trim();
  const menuMatches = useMemo(() => {
    if (!cfg || !q) return null;
    const hit = new Map<number, Set<number>>();
    cfg.menu.forEach((cat, ci) => {
      const items = new Set<number>();
      cat.items.forEach((it, ii) => {
        if (`${it.name} ${it.description ?? ""} ${it.price}`.includes(q)) items.add(ii);
      });
      if (items.size || cat.name.includes(q)) hit.set(ci, items);
    });
    return hit;
  }, [cfg, q]);

  if (!cfg) return <div className="text-[var(--muted)] text-sm">{msg || "טוען…"}</div>;

  const up = (patch: Partial<BusinessConfig>) => setCfg({ ...cfg, ...patch });
  const upContact = (patch: Partial<BusinessConfig["contact"]>) => setCfg({ ...cfg, contact: { ...cfg.contact, ...patch } });
  const soldOut = cfg.menu.reduce((n, c) => n + c.items.filter((i) => i.available === false).length, 0);
  const futureDates = (cfg.hoursOverrides ?? []).filter((o) => o.date >= todayILStr()).length;

  async function save() {
    setSaving(true);
    setMsg("");
    try {
      await api(token, "/business-config", { method: "PUT", body: JSON.stringify(cfg) });
      savedSnapshot.current = JSON.stringify(cfg);
      setUnsaved(false);
      setMsg("נשמר! הבוט כבר משתמש במידע המעודכן ✓");
    } catch (e) {
      setMsg(`⚠ ${e instanceof Error ? e.message : "שמירה נכשלה"}`);
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(""), 4000);
    }
  }

  const toggleCat = (ci: number) =>
    setOpenCats((s) => {
      const n = new Set(s);
      n.has(ci) ? n.delete(ci) : n.add(ci);
      return n;
    });
  const toggleItem = (k: string) =>
    setOpenItems((s) => {
      const n = new Set(s);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });

  const current = TABS.find((t) => t.key === tab)!;

  return (
    <div className="max-w-[1100px] space-y-3">
      {/* ניווט בין ארבעת המסכים - נגלל אופקית בטלפון */}
      <nav className="-mx-3 px-3 md:mx-0 md:px-0 overflow-x-auto no-scrollbar">
        <div className="flex gap-1.5 min-w-max md:min-w-0">
          {TABS.map((t) => {
            const on = t.key === tab;
            const badge = t.key === "menu" && soldOut ? soldOut : t.key === "hours" && futureDates ? futureDates : 0;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                aria-current={on ? "page" : undefined}
                className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm whitespace-nowrap border transition ${
                  on
                    ? "bg-[var(--accent)] text-[var(--accent-fg)] border-transparent font-semibold"
                    : "bg-[var(--panel)] border-[var(--border)] text-[var(--text)] hover:border-[var(--accent)]"
                }`}
              >
                <span aria-hidden>{t.icon}</span>
                {t.label}
                {badge > 0 && (
                  <span
                    className={`text-[10px] rounded-full px-1.5 font-bold ${
                      on ? "bg-[var(--accent-fg)]/20" : "bg-[var(--accent)]/15 text-[var(--accent)]"
                    }`}
                  >
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>
      <p className="text-xs text-[var(--muted)] px-0.5">{current.sub}</p>

      {/* ═══════════ שעות ותאריכים ═══════════ */}
      {tab === "hours" && (
        <div className="space-y-3">
          <Block title="המנה / המבצע של היום" sub="משפט אחד. הבוט ישלב אותו בטבעיות כשרלוונטי, בלי לדחוף. ריק = לא מזכיר.">
            <input
              value={cfg.specialToday ?? ""}
              onChange={(e) => up({ specialToday: e.target.value })}
              placeholder="למשל: היום פוקצ'ה טרייה מהטאבון עד גמר המלאי"
              className={inputCls}
            />
          </Block>

          <Block title="שעות פעילות קבועות" sub="משפיע על הכל: תשובות שעות, 'פתוחים עכשיו?', ואילו הזמנות מותר לקבל.">
            <div className="space-y-1.5">
              {cfg.hours.map((h, i) => {
                const closed = h.hours === null;
                return (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-14 text-sm font-medium shrink-0">{h.day}</span>
                    {closed ? (
                      <span className="flex-1 text-sm text-[var(--muted)] bg-[var(--panel2)] border border-[var(--border)] rounded-lg px-2.5 py-2">
                        סגור
                      </span>
                    ) : (
                      <input
                        value={h.hours ?? ""}
                        placeholder="08:00-18:00"
                        onChange={(e) => {
                          const next = [...cfg.hours];
                          next[i] = { ...h, hours: e.target.value || null };
                          up({ hours: next });
                        }}
                        className={`${inputCls} flex-1`}
                        style={{ fontVariantNumeric: "tabular-nums" }}
                      />
                    )}
                    <button
                      onClick={() => {
                        const next = [...cfg.hours];
                        next[i] = { ...h, hours: closed ? "08:00-18:00" : null };
                        up({ hours: next });
                      }}
                      className={`shrink-0 text-[11px] rounded-lg px-2.5 py-2 border transition ${
                        closed
                          ? "bg-[var(--accent)]/15 text-[var(--accent)] border-[var(--accent)]/40 font-semibold"
                          : "text-[var(--muted)] border-[var(--border)] hover:text-[var(--text)]"
                      }`}
                    >
                      סגור
                    </button>
                  </div>
                );
              })}
            </div>
          </Block>

          <Block
            title="🗓️ תאריכים מיוחדים"
            sub="ערב חג, צום, סגירה מוקדמת. הגדירו מראש - הבוט יענה נכון גם ללקוח ששואל ימים לפני, ותאריכים שעברו נמחקים לבד."
          >
            <div className="space-y-2">
              {(cfg.hoursOverrides ?? []).map((o, i) => {
                const upO = (patch: Partial<{ date: string; hours: string | null; note?: string }>) => {
                  const arr = [...(cfg.hoursOverrides ?? [])];
                  arr[i] = { ...o, ...patch };
                  up({ hoursOverrides: arr });
                };
                const wd = weekdayHe(o.date);
                const past = !!o.date && o.date < todayILStr();
                const closed = o.hours === null;
                return (
                  <div
                    key={i}
                    className={`rounded-xl p-2.5 space-y-2 border ${
                      past ? "border-[var(--border)] opacity-60" : "border-[var(--accent)]/25 bg-[var(--panel2)]"
                    }`}
                  >
                    <div className="flex gap-2 items-center flex-wrap">
                      <input
                        type="date"
                        value={o.date}
                        onChange={(ev) => upO({ date: ev.target.value })}
                        className={`${inputCls} !w-auto flex-1 min-w-36`}
                      />
                      {wd && <span className="text-xs text-[var(--muted)] shrink-0">יום {wd}</span>}
                      {past && <span className="text-[10px] bg-[var(--panel)] text-[var(--muted)] rounded-full px-2 py-0.5">עבר</span>}
                      <button
                        onClick={() => up({ hoursOverrides: (cfg.hoursOverrides ?? []).filter((_, j) => j !== i) })}
                        className="shrink-0 w-8 h-8 grid place-items-center rounded-lg text-[var(--muted)] hover:text-red-400 hover:bg-red-500/10 text-lg leading-none mr-auto"
                        aria-label="מחק תאריך מיוחד"
                      >
                        ×
                      </button>
                    </div>
                    <div className="flex gap-2 items-center flex-wrap">
                      <button
                        onClick={() => upO({ hours: closed ? "10:00-23:00" : null })}
                        className={`shrink-0 text-[11px] rounded-lg px-2.5 py-2 border transition ${
                          closed
                            ? "bg-[var(--accent)]/15 text-[var(--accent)] border-[var(--accent)]/40 font-semibold"
                            : "text-[var(--muted)] border-[var(--border)] hover:text-[var(--text)]"
                        }`}
                      >
                        סגור כל היום
                      </button>
                      {!closed && (
                        <input
                          value={o.hours ?? ""}
                          placeholder="10:00-15:00"
                          onChange={(ev) => upO({ hours: ev.target.value })}
                          className={`${inputCls} !w-36 shrink-0`}
                          style={{ fontVariantNumeric: "tabular-nums" }}
                        />
                      )}
                      <input
                        value={o.note ?? ""}
                        placeholder="סיבה (ערב חג) - הבוט יציין אותה"
                        onChange={(ev) => upO({ note: ev.target.value || undefined })}
                        className={`${inputCls} flex-1 min-w-40 text-xs`}
                      />
                    </div>
                  </div>
                );
              })}
              <button
                onClick={() => up({ hoursOverrides: [...(cfg.hoursOverrides ?? []), { date: "", hours: null }] })}
                className="text-sm text-[var(--accent)] font-semibold hover:underline"
              >
                + הוסף תאריך מיוחד
              </button>
            </div>
          </Block>

          <Block title="הקרנות משחקים" sub="הבוט מחשב לבד אם זה היום או מחר, ומזכיר בטבעיות. אחרי שהמשחק עובר הוא נעלם.">
            <datalist id="competitions">
              {["מונדיאל", "יורו", "ליגת האלופות", "ליגת העל", "ליגת האירופה", "ליגה אנגלית", "ליגה ספרדית"].map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <div className="space-y-2">
              {(cfg.events ?? []).map((e, i) => {
                const upEvent = (patch: Partial<{ competition: string; teamA: string; teamB: string; date: string; time: string; kind: "screening" }>) => {
                  const events = [...(cfg.events ?? [])];
                  events[i] = { ...e, kind: "screening", ...patch };
                  up({ events });
                };
                return (
                  <div key={i} className="border border-[var(--border)] rounded-xl p-2.5 space-y-2 bg-[var(--panel2)]">
                    <div className="flex gap-2 items-center">
                      <input
                        list="competitions"
                        value={e.competition ?? ""}
                        placeholder="תחרות"
                        onChange={(ev) => upEvent({ competition: ev.target.value })}
                        className={`${inputCls} flex-1 font-medium`}
                      />
                      <button
                        onClick={() => up({ events: (cfg.events ?? []).filter((_, j) => j !== i) })}
                        className="shrink-0 w-8 h-8 grid place-items-center rounded-lg text-[var(--muted)] hover:text-red-400 hover:bg-red-500/10 text-lg leading-none"
                        aria-label="מחק הקרנה"
                      >
                        ×
                      </button>
                    </div>
                    <div className="flex gap-2 items-center">
                      <input value={e.teamA ?? ""} placeholder="קבוצה א'" onChange={(ev) => upEvent({ teamA: ev.target.value })} className={inputCls} />
                      <span className="text-xs text-[var(--muted)] shrink-0">מול</span>
                      <input value={e.teamB ?? ""} placeholder="קבוצה ב'" onChange={(ev) => upEvent({ teamB: ev.target.value })} className={inputCls} />
                    </div>
                    <div className="flex gap-2">
                      <input type="date" value={e.date ?? ""} onChange={(ev) => upEvent({ date: ev.target.value })} className={`${inputCls} flex-1`} />
                      <input type="time" value={e.time ?? ""} onChange={(ev) => upEvent({ time: ev.target.value })} className={`${inputCls} !w-28 shrink-0`} />
                    </div>
                  </div>
                );
              })}
              <button
                onClick={() => up({ events: [...(cfg.events ?? []), { kind: "screening", competition: "מונדיאל", teamA: "", teamB: "", date: "", time: "22:00" }] })}
                className="text-sm text-[var(--accent)] font-semibold hover:underline"
              >
                + הוסף הקרנת משחק
              </button>
            </div>
          </Block>
        </div>
      )}

      {/* ═══════════ תפריט ═══════════ */}
      {tab === "menu" && (
        <div className="space-y-3">
          <div className="flex gap-2 items-center">
            <input
              value={menuQuery}
              onChange={(e) => setMenuQuery(e.target.value)}
              placeholder="חיפוש מנה, מחיר או תיאור…"
              className={inputCls}
            />
            {q && (
              <button onClick={() => setMenuQuery("")} className="shrink-0 text-xs text-[var(--muted)] hover:text-[var(--text)] px-2">
                נקה
              </button>
            )}
          </div>
          {soldOut > 0 && (
            <p className="text-xs text-amber-500 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2">
              {soldOut} מנות מסומנות כ&quot;אזל&quot; - הבוט אומר עליהן שהן לא זמינות כרגע.
            </p>
          )}

          <div className="space-y-2">
            {cfg.menu.map((cat, ci) => {
              const matched = menuMatches?.get(ci);
              if (menuMatches && !matched) return null;
              const isOpen = q ? true : openCats.has(ci);
              const catSoldOut = cat.items.filter((i) => i.available === false).length;
              return (
                <div key={ci} className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl overflow-hidden">
                  <button
                    onClick={() => !q && toggleCat(ci)}
                    className="w-full flex items-center gap-2 px-3.5 py-3 text-right hover:bg-[var(--panel2)] transition"
                  >
                    <span className="font-semibold text-sm font-display truncate">{cat.name}</span>
                    <span className="text-[11px] text-[var(--muted)] bg-[var(--panel2)] rounded-full px-2 py-0.5 shrink-0">
                      {cat.items.length}
                    </span>
                    {catSoldOut > 0 && (
                      <span className="text-[10px] text-amber-500 bg-amber-500/15 rounded-full px-2 py-0.5 shrink-0">{catSoldOut} אזלו</span>
                    )}
                    {!q && <span className="mr-auto text-[var(--muted)] text-lg leading-none shrink-0">{isOpen ? "−" : "+"}</span>}
                  </button>

                  {isOpen && (
                    <div className="px-3 pb-3 space-y-2 border-t border-[var(--border)] pt-2.5">
                      <div className="flex gap-2 items-center">
                        <input
                          value={cat.name}
                          onChange={(e) => {
                            const menu = [...cfg.menu];
                            menu[ci] = { ...cat, name: e.target.value };
                            up({ menu });
                          }}
                          className={`${inputCls} text-xs`}
                          aria-label="שם הקטגוריה"
                        />
                        <input
                          value={cat.note ?? ""}
                          placeholder="הערה (למשל: מוגש עד 15:00)"
                          onChange={(e) => {
                            const menu = [...cfg.menu];
                            menu[ci] = { ...cat, note: e.target.value || undefined };
                            up({ menu });
                          }}
                          className={`${inputCls} text-xs`}
                        />
                        <button
                          onClick={() => {
                            if (confirm(`למחוק את הקטגוריה "${cat.name}" על כל המנות שבה?`)) up({ menu: cfg.menu.filter((_, j) => j !== ci) });
                          }}
                          className="shrink-0 w-8 h-8 grid place-items-center rounded-lg text-[var(--muted)] hover:text-red-400 hover:bg-red-500/10 text-lg leading-none"
                          aria-label="מחק קטגוריה"
                        >
                          ×
                        </button>
                      </div>

                      {cat.items.map((it, ii) => {
                        if (matched && matched.size && !matched.has(ii)) return null;
                        const key = `${ci}-${ii}`;
                        const expanded = openItems.has(key);
                        const out = it.available === false;
                        const patchItem = (patch: Partial<(typeof cat.items)[number]>) => {
                          const menu = [...cfg.menu];
                          const items = [...cat.items];
                          items[ii] = { ...it, ...patch };
                          menu[ci] = { ...cat, items };
                          up({ menu });
                        };
                        return (
                          <div
                            key={ii}
                            className={`bg-[var(--panel2)] border rounded-xl p-2 space-y-2 ${
                              out ? "border-amber-500/40" : "border-[var(--border)]"
                            }`}
                          >
                            <div className="flex gap-1.5 items-center">
                              <input
                                value={it.name}
                                placeholder="שם המנה"
                                aria-label="שם המנה"
                                onChange={(e) => patchItem({ name: e.target.value })}
                                className={`${inputCls} flex-1 min-w-0 font-medium ${out ? "line-through opacity-70" : ""}`}
                              />
                              <input
                                value={it.price}
                                placeholder="₪"
                                aria-label="מחיר"
                                title={it.price}
                                onChange={(e) => patchItem({ price: e.target.value })}
                                className={`${inputCls} !w-24 shrink-0 text-center text-xs`}
                                style={{ fontVariantNumeric: "tabular-nums" }}
                              />
                              <button
                                onClick={() => patchItem({ available: out ? undefined : false })}
                                title={out ? "המנה מסומנת כאזלה - לחצו כדי להחזיר" : "סמן שהמנה אזלה"}
                                className={`shrink-0 h-9 px-2 rounded-lg border text-[11px] font-semibold transition ${
                                  out
                                    ? "bg-amber-500/20 text-amber-500 border-amber-500/50"
                                    : "text-[var(--muted)] border-[var(--border)] hover:text-[var(--text)]"
                                }`}
                              >
                                אזל
                              </button>
                              <button
                                onClick={() => toggleItem(key)}
                                aria-expanded={expanded}
                                aria-label="פרטים נוספים"
                                className="shrink-0 w-8 h-8 grid place-items-center rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--panel)] text-sm"
                              >
                                {expanded ? "−" : "⋯"}
                              </button>
                            </div>

                            {expanded && (
                              <div className="space-y-2 pt-1">
                                <label className="block">
                                  <span className="text-[10px] text-[var(--muted)] mb-0.5 block">מחיר מלא (אפשר טקסט: &quot;יחיד ₪89 / זוגי ₪159&quot;)</span>
                                  <input
                                    value={it.price}
                                    onChange={(e) => patchItem({ price: e.target.value })}
                                    className={`${inputCls} text-xs`}
                                  />
                                </label>
                                <input
                                  value={it.description ?? ""}
                                  placeholder="תיאור המנה (אופציונלי)"
                                  onChange={(e) => patchItem({ description: e.target.value || undefined })}
                                  className={`${inputCls} text-xs`}
                                />
                                <ChipPicker label="תגיות" presets={DIET_TAGS} selected={it.tags ?? []} onChange={(tags) => patchItem({ tags })} />
                                <ChipPicker
                                  label="אלרגנים"
                                  danger
                                  presets={ALLERGENS}
                                  selected={it.allergens ?? []}
                                  onChange={(allergens) => patchItem({ allergens })}
                                />
                                <button
                                  onClick={() => {
                                    const menu = [...cfg.menu];
                                    menu[ci] = { ...cat, items: cat.items.filter((_, j) => j !== ii) };
                                    up({ menu });
                                  }}
                                  className="text-xs text-[var(--muted)] hover:text-red-400"
                                >
                                  מחק את המנה
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {!q && (
                        <button
                          onClick={() => {
                            const menu = [...cfg.menu];
                            menu[ci] = { ...cat, items: [...cat.items, { name: "", price: "" }] };
                            up({ menu });
                          }}
                          className="w-full min-h-10 border-2 border-dashed border-[var(--border)] rounded-xl text-sm text-[var(--accent)] font-semibold hover:border-[var(--accent)] transition"
                        >
                          + הוסף מנה
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {menuMatches && menuMatches.size === 0 && (
              <p className="text-sm text-[var(--muted)] text-center py-6">לא נמצאו מנות שמתאימות ל&quot;{q}&quot;</p>
            )}
            {!q && (
              <button
                onClick={() => {
                  up({ menu: [...cfg.menu, { name: "קטגוריה חדשה", items: [] }] });
                  setOpenCats((s) => new Set(s).add(cfg.menu.length));
                }}
                className="text-sm text-[var(--accent)] font-semibold hover:underline"
              >
                + הוסף קטגוריה
              </button>
            )}
          </div>
        </div>
      )}

      {/* ═══════════ מדיניות ושאלות ═══════════ */}
      {tab === "policies" && (
        <div className="space-y-3">
          <Block title="שאלות נפוצות" sub="הבוט עונה עליהן מילה במילה, בלי לשלם על מודל. שווה לנסח בדיוק כמו שהייתם עונים.">
            <div className="space-y-2">
              {cfg.faqs.map((f, i) => (
                <div key={i} className="border border-[var(--border)] rounded-xl p-2.5 space-y-2 bg-[var(--panel2)]">
                  <div className="flex gap-2 items-center">
                    <input
                      value={f.question}
                      placeholder="שאלה"
                      onChange={(e) => {
                        const faqs = [...cfg.faqs];
                        faqs[i] = { ...f, question: e.target.value };
                        up({ faqs });
                      }}
                      className={`${inputCls} font-medium`}
                    />
                    <button
                      onClick={() => up({ faqs: cfg.faqs.filter((_, j) => j !== i) })}
                      className="shrink-0 w-8 h-8 grid place-items-center rounded-lg text-[var(--muted)] hover:text-red-400 hover:bg-red-500/10 text-lg leading-none"
                      aria-label="מחק שאלה"
                    >
                      ×
                    </button>
                  </div>
                  <textarea
                    value={f.answer}
                    placeholder="תשובה"
                    rows={2}
                    onChange={(e) => {
                      const faqs = [...cfg.faqs];
                      faqs[i] = { ...f, answer: e.target.value };
                      up({ faqs });
                    }}
                    className={`${inputCls} text-xs leading-relaxed`}
                  />
                </div>
              ))}
              <button onClick={() => up({ faqs: [...cfg.faqs, { question: "", answer: "" }] })} className="text-sm text-[var(--accent)] font-semibold hover:underline">
                + הוסף שאלה
              </button>
            </div>
          </Block>

          <Block title="מדיניות ונהלים" sub="תשלום, הזמנות, עישון, ביטולים. כל שורה היא כלל שהבוט מכיר.">
            <StringList items={cfg.policies ?? []} onChange={(v) => up({ policies: v })} placeholder="הוסף שורת מדיניות" />
          </Block>

          <Block title="מתקנים והטבות" sub="וויפיי, נגישות, כיסאות תינוק, גינת ילדים.">
            <StringList items={cfg.amenities ?? []} onChange={(v) => up({ amenities: v })} placeholder="הוסף מתקן" />
          </Block>

          <Block title="כשרות">
            <input value={cfg.kashrut ?? ""} onChange={(e) => up({ kashrut: e.target.value })} className={inputCls} />
          </Block>

          {cfg.parking && (
            <Block title="חניה" sub="מה שהבוט אומר על החניה, ואיך מגיעים אליה.">
              <Field label="תקציר" value={cfg.parking.summary} onChange={(v) => up({ parking: { ...cfg.parking!, summary: v } })} area rows={2} />
              <Field label="מחיר" value={cfg.parking.price} onChange={(v) => up({ parking: { ...cfg.parking!, price: v } })} />
              <Field label="הוראות הגעה" value={cfg.parking.directions} onChange={(v) => up({ parking: { ...cfg.parking!, directions: v } })} area rows={4} />
            </Block>
          )}
        </div>
      )}

      {/* ═══════════ פרטי העסק ═══════════ */}
      {tab === "profile" && (
        <div className="space-y-3">
          <Block title="זהות העסק" sub="נוגעים בזה לעיתים רחוקות. שינוי כאן משפיע על איך הבוט מציג את המקום בכל שיחה.">
            <Field label="שם העסק" value={cfg.name} onChange={(v) => up({ name: v })} />
            <Field label="תיאור" value={cfg.description} onChange={(v) => up({ description: v })} area rows={5} />
          </Block>

          <Block title="איך הבוט מדבר" sub="הטון והברכה. שינוי כאן מורגש בכל תשובה - עדיף לשנות מעט ולבדוק.">
            <Field label="ברכת פתיחה" value={cfg.greeting} onChange={(v) => up({ greeting: v })} area rows={3} />
            <Field label="טון הדיבור" value={cfg.tone} onChange={(v) => up({ tone: v })} area rows={5} />
          </Block>

          <Block title="פרטי קשר" sub="מה שהבוט מוסר ללקוחות. הקישורים נשלחים כמו שהם.">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="טלפון" value={cfg.contact.phone} onChange={(v) => upContact({ phone: v })} />
              <Field label="כתובת" value={cfg.contact.address} onChange={(v) => upContact({ address: v })} />
              <Field label="ניווט (Waze)" value={cfg.contact.navigationUrl} onChange={(v) => upContact({ navigationUrl: v })} />
              <Field label="קישור להזמנת מקום" value={cfg.contact.reservationUrl} onChange={(v) => upContact({ reservationUrl: v })} />
              <Field label="אתר" value={cfg.contact.website} onChange={(v) => upContact({ website: v })} />
              <Field label="אינסטגרם" value={cfg.contact.instagram} onChange={(v) => upContact({ instagram: v })} />
              <Field label="פייסבוק" value={cfg.contact.facebook} onChange={(v) => upContact({ facebook: v })} />
              <Field label="טיקטוק" value={cfg.contact.tiktok} onChange={(v) => upContact({ tiktok: v })} />
              <Field
                label="וואטסאפ"
                value={cfg.contact.whatsapp}
                onChange={(v) => upContact({ whatsapp: v })}
                hint="נמסר רק כשלקוח שואל במפורש - הבוט לא מציע אותו מיוזמתו."
              />
            </div>
          </Block>
        </div>
      )}

      {/* סרגל שמירה */}
      <div className="sticky bottom-0 -mx-3 md:mx-0 bg-[var(--panel)] border-t border-[var(--border)] p-3 flex items-center gap-3 justify-end z-20 rounded-t-xl">
        {msg && <span className={`text-xs ${msg.startsWith("⚠") ? "text-red-400" : "text-[var(--accent)]"}`}>{msg}</span>}
        {dirty && !msg && <span className="text-xs text-amber-500 font-semibold">● יש שינויים שלא נשמרו</span>}
        {def && (
          <button
            onClick={() => {
              if (confirm("לאפס לכל נתוני ברירת המחדל המקוריים? (השינויים ייכנסו לתוקף רק אחרי שמירה)")) setCfg({ ...def });
            }}
            className="text-xs text-[var(--muted)] hover:text-[var(--text)]"
          >
            אפס לברירת מחדל
          </button>
        )}
        <button
          onClick={save}
          disabled={saving || !dirty}
          className="bg-[var(--accent)] text-[var(--accent-fg)] font-semibold rounded-xl px-5 py-2.5 text-sm disabled:opacity-50"
        >
          {saving ? "שומר…" : dirty ? "שמור שינויים" : "הכל שמור ✓"}
        </button>
      </div>
    </div>
  );
}
