"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, type BusinessConfig } from "./types";
import { setUnsaved } from "./dirty";

const inputCls =
  "w-full bg-[var(--panel2)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-[var(--accent)]";

function Field({ label, value, onChange, area }: { label: string; value?: string; onChange: (v: string) => void; area?: boolean }) {
  return (
    <label className="block">
      <span className="text-xs text-[var(--muted)] mb-1 block">{label}</span>
      {area ? (
        <textarea value={value ?? ""} onChange={(e) => onChange(e.target.value)} rows={3} className={inputCls} />
      ) : (
        <input value={value ?? ""} onChange={(e) => onChange(e.target.value)} className={inputCls} />
      )}
    </label>
  );
}

function Section({ title, children, defaultOpen }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between px-4 py-3 text-right">
        <span className="font-semibold text-sm">{title}</span>
        <span className="text-[var(--muted)]">{open ? "−" : "+"}</span>
      </button>
      {open && <div className="px-4 pb-4 space-y-3 border-t border-[var(--border)] pt-3">{children}</div>}
    </div>
  );
}

function StringList({ items, onChange, placeholder }: { items: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  return (
    <div className="space-y-1.5">
      {items.map((it, i) => (
        <div key={i} className="flex gap-2">
          <input
            value={it}
            onChange={(e) => {
              const next = [...items];
              next[i] = e.target.value;
              onChange(next);
            }}
            className={inputCls}
          />
          <button onClick={() => onChange(items.filter((_, j) => j !== i))} className="text-[var(--muted)] hover:text-red-400 px-1">
            ×
          </button>
        </div>
      ))}
      <button onClick={() => onChange([...items, ""])} className="text-xs text-[var(--accent)] hover:underline">
        + {placeholder}
      </button>
    </div>
  );
}

export default function BusinessEditor({ token }: { token: string }) {
  const [cfg, setCfg] = useState<BusinessConfig | null>(null);
  const [def, setDef] = useState<BusinessConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
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

  // שינויים לא שמורים: מסמנים ל-shell (מעבר טאב יזהיר) + אזהרת עזיבת דף
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

  if (!cfg) return <div className="text-[var(--muted)] text-sm">{msg || "טוען…"}</div>;

  const up = (patch: Partial<BusinessConfig>) => setCfg({ ...cfg, ...patch });
  const upContact = (patch: Partial<BusinessConfig["contact"]>) => setCfg({ ...cfg, contact: { ...cfg.contact, ...patch } });

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

  return (
    <div className="max-w-3xl space-y-3">
      <p className="text-xs text-[var(--muted)]">
        כל מה שתערוך כאן הבוט יידע מיד - שעות, מחירים, מנות, תשובות. אין צורך לגעת בקוד. אל תשכח לשמור בסוף.
      </p>

      <Section title="פרטים כלליים" defaultOpen>
        <Field label="שם העסק" value={cfg.name} onChange={(v) => up({ name: v })} />
        <Field label="תיאור" value={cfg.description} onChange={(v) => up({ description: v })} area />
        <Field label="כשרות" value={cfg.kashrut} onChange={(v) => up({ kashrut: v })} />
        <Field label="המנה / מבצע של היום (הבוט יזכיר כשרלוונטי)" value={cfg.specialToday} onChange={(v) => up({ specialToday: v })} />
        <Field label="ברכת פתיחה" value={cfg.greeting} onChange={(v) => up({ greeting: v })} area />
        <Field label="טון הדיבור של הבוט" value={cfg.tone} onChange={(v) => up({ tone: v })} area />
      </Section>

      <Section title="פרטי קשר">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="טלפון" value={cfg.contact.phone} onChange={(v) => upContact({ phone: v })} />
          <Field label="כתובת" value={cfg.contact.address} onChange={(v) => upContact({ address: v })} />
          <Field label="אתר" value={cfg.contact.website} onChange={(v) => upContact({ website: v })} />
          <Field label="קישור להזמנת מקום" value={cfg.contact.reservationUrl} onChange={(v) => upContact({ reservationUrl: v })} />
          <Field label="אינסטגרם" value={cfg.contact.instagram} onChange={(v) => upContact({ instagram: v })} />
          <Field label="פייסבוק" value={cfg.contact.facebook} onChange={(v) => upContact({ facebook: v })} />
        </div>
      </Section>

      <Section title="שעות פעילות">
        <div className="space-y-2">
          {cfg.hours.map((h, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-16 text-sm">{h.day}</span>
              <input
                value={h.hours ?? ""}
                placeholder="סגור"
                onChange={(e) => {
                  const next = [...cfg.hours];
                  next[i] = { ...h, hours: e.target.value || null };
                  up({ hours: next });
                }}
                className={inputCls}
              />
              <label className="flex items-center gap-1 text-xs text-[var(--muted)] shrink-0">
                <input
                  type="checkbox"
                  checked={h.hours === null}
                  onChange={(e) => {
                    const next = [...cfg.hours];
                    next[i] = { ...h, hours: e.target.checked ? null : "07:00-18:00" };
                    up({ hours: next });
                  }}
                />
                סגור
              </label>
            </div>
          ))}
        </div>
      </Section>

      <Section title="תפריט">
        <div className="space-y-4">
          {cfg.menu.map((cat, ci) => (
            <div key={ci} className="border border-[var(--border)] rounded-xl p-3 space-y-2">
              <div className="flex gap-2 items-center">
                <input
                  value={cat.name}
                  onChange={(e) => {
                    const menu = [...cfg.menu];
                    menu[ci] = { ...cat, name: e.target.value };
                    up({ menu });
                  }}
                  className={`${inputCls} font-semibold`}
                />
                <button
                  onClick={() => up({ menu: cfg.menu.filter((_, j) => j !== ci) })}
                  className="text-[var(--muted)] hover:text-red-400 text-xs shrink-0"
                >
                  מחק קטגוריה
                </button>
              </div>
              <input
                value={cat.note ?? ""}
                placeholder="הערה לקטגוריה (אופציונלי)"
                onChange={(e) => {
                  const menu = [...cfg.menu];
                  menu[ci] = { ...cat, note: e.target.value || undefined };
                  up({ menu });
                }}
                className={`${inputCls} text-xs`}
              />
              <div className="space-y-1.5">
                {cat.items.map((it, ii) => (
                  <div key={ii} className="flex gap-1.5 items-start bg-[var(--panel2)] rounded-lg p-1.5">
                    <div className="flex-1 space-y-1">
                      <div className="flex gap-1.5">
                        <input
                          value={it.name}
                          placeholder="שם מנה"
                          onChange={(e) => {
                            const menu = [...cfg.menu];
                            const items = [...cat.items];
                            items[ii] = { ...it, name: e.target.value };
                            menu[ci] = { ...cat, items };
                            up({ menu });
                          }}
                          className={`${inputCls} flex-1`}
                        />
                        <input
                          value={it.price}
                          placeholder="מחיר"
                          onChange={(e) => {
                            const menu = [...cfg.menu];
                            const items = [...cat.items];
                            items[ii] = { ...it, price: e.target.value };
                            menu[ci] = { ...cat, items };
                            up({ menu });
                          }}
                          className={`${inputCls} w-40`}
                        />
                      </div>
                      <input
                        value={it.description ?? ""}
                        placeholder="תיאור (אופציונלי)"
                        onChange={(e) => {
                          const menu = [...cfg.menu];
                          const items = [...cat.items];
                          items[ii] = { ...it, description: e.target.value || undefined };
                          menu[ci] = { ...cat, items };
                          up({ menu });
                        }}
                        className={`${inputCls} text-xs`}
                      />
                      <label className="flex items-center gap-1 text-[11px] text-[var(--muted)]">
                        <input
                          type="checkbox"
                          checked={it.available === false}
                          onChange={(e) => {
                            const menu = [...cfg.menu];
                            const items = [...cat.items];
                            items[ii] = { ...it, available: e.target.checked ? false : undefined };
                            menu[ci] = { ...cat, items };
                            up({ menu });
                          }}
                        />
                        אזל כרגע (לא זמין)
                      </label>
                    </div>
                    <button
                      onClick={() => {
                        const menu = [...cfg.menu];
                        menu[ci] = { ...cat, items: cat.items.filter((_, j) => j !== ii) };
                        up({ menu });
                      }}
                      className="text-[var(--muted)] hover:text-red-400 px-1"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => {
                    const menu = [...cfg.menu];
                    menu[ci] = { ...cat, items: [...cat.items, { name: "", price: "" }] };
                    up({ menu });
                  }}
                  className="text-xs text-[var(--accent)] hover:underline"
                >
                  + הוסף מנה
                </button>
              </div>
            </div>
          ))}
          <button
            onClick={() => up({ menu: [...cfg.menu, { name: "קטגוריה חדשה", items: [] }] })}
            className="text-sm text-[var(--accent)] hover:underline"
          >
            + הוסף קטגוריה
          </button>
        </div>
      </Section>

      <Section title="שאלות נפוצות">
        <div className="space-y-2">
          {cfg.faqs.map((f, i) => (
            <div key={i} className="border border-[var(--border)] rounded-xl p-2.5 space-y-1.5">
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
              <div className="flex gap-1.5">
                <textarea
                  value={f.answer}
                  placeholder="תשובה"
                  rows={2}
                  onChange={(e) => {
                    const faqs = [...cfg.faqs];
                    faqs[i] = { ...f, answer: e.target.value };
                    up({ faqs });
                  }}
                  className={inputCls}
                />
                <button onClick={() => up({ faqs: cfg.faqs.filter((_, j) => j !== i) })} className="text-[var(--muted)] hover:text-red-400 px-1">
                  ×
                </button>
              </div>
            </div>
          ))}
          <button onClick={() => up({ faqs: [...cfg.faqs, { question: "", answer: "" }] })} className="text-sm text-[var(--accent)] hover:underline">
            + הוסף שאלה
          </button>
        </div>
      </Section>

      <Section title="מדיניות והטבות">
        <div>
          <span className="text-xs text-[var(--muted)] mb-1 block">מדיניות (תשלום, הזמנות, עישון…)</span>
          <StringList items={cfg.policies ?? []} onChange={(v) => up({ policies: v })} placeholder="הוסף שורת מדיניות" />
        </div>
        <div>
          <span className="text-xs text-[var(--muted)] mb-1 block">מתקנים / הטבות</span>
          <StringList items={cfg.amenities ?? []} onChange={(v) => up({ amenities: v })} placeholder="הוסף מתקן" />
        </div>
      </Section>

      <Section title="הקרנות משחקים">
        <p className="text-xs text-[var(--muted)]">
          הוסף הקרנת משחק: ציין את התחרות (מונדיאל / ליגת האלופות וכו'), הקבוצות, התאריך והשעה. הבוט יחשב לבד אם זה היום/מחר
          וישלב את זה בטבעיות בשיחה. אחרי שהמשחק עובר, הוא נעלם אוטומטית.
        </p>
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
              <div key={i} className="border border-[var(--border)] rounded-xl p-2.5 space-y-1.5">
                <div className="flex gap-1.5 items-center">
                  <input
                    list="competitions"
                    value={e.competition ?? ""}
                    placeholder="תחרות (מונדיאל)"
                    onChange={(ev) => upEvent({ competition: ev.target.value })}
                    className={`${inputCls} w-44 font-medium`}
                  />
                  <span className="text-xs text-[var(--muted)]">הקרנת משחק</span>
                  <button onClick={() => up({ events: (cfg.events ?? []).filter((_, j) => j !== i) })} className="text-[var(--muted)] hover:text-red-400 px-1 mr-auto">×</button>
                </div>
                <div className="flex gap-1.5 items-center">
                  <input value={e.teamA ?? ""} placeholder="קבוצה א'" onChange={(ev) => upEvent({ teamA: ev.target.value })} className={inputCls} />
                  <span className="text-xs text-[var(--muted)] shrink-0">מול</span>
                  <input value={e.teamB ?? ""} placeholder="קבוצה ב'" onChange={(ev) => upEvent({ teamB: ev.target.value })} className={inputCls} />
                </div>
                <div className="flex gap-1.5">
                  <input type="date" value={e.date ?? ""} onChange={(ev) => upEvent({ date: ev.target.value })} className={`${inputCls} w-40`} />
                  <input type="time" value={e.time ?? ""} onChange={(ev) => upEvent({ time: ev.target.value })} className={`${inputCls} w-28`} />
                </div>
              </div>
            );
          })}
          <button
            onClick={() => up({ events: [...(cfg.events ?? []), { kind: "screening", competition: "מונדיאל", teamA: "", teamB: "", date: "", time: "22:00" }] })}
            className="text-sm text-[var(--accent)] hover:underline"
          >
            + הוסף הקרנת משחק
          </button>
        </div>
      </Section>

      <Section title="שעות חריגות (חגים / לילות מיוחדים)">
        <p className="text-xs text-[var(--muted)]">דריסה נקודתית של השעות לתאריך מסוים. גוברת על השעות הקבועות באותו יום.</p>
        <div className="space-y-2">
          {(cfg.hoursOverrides ?? []).map((o, i) => {
            const upO = (patch: Partial<{ date: string; hours: string | null; note?: string }>) => {
              const arr = [...(cfg.hoursOverrides ?? [])];
              arr[i] = { ...o, ...patch };
              up({ hoursOverrides: arr });
            };
            return (
              <div key={i} className="flex gap-1.5 items-center">
                <input type="date" value={o.date} onChange={(ev) => upO({ date: ev.target.value })} className={`${inputCls} w-36`} />
                <input value={o.hours ?? ""} placeholder="סגור" onChange={(ev) => upO({ hours: ev.target.value || null })} className={`${inputCls} w-32`} />
                <input value={o.note ?? ""} placeholder="הערה (אופציונלי)" onChange={(ev) => upO({ note: ev.target.value || undefined })} className={`${inputCls} text-xs`} />
                <button onClick={() => up({ hoursOverrides: (cfg.hoursOverrides ?? []).filter((_, j) => j !== i) })} className="text-[var(--muted)] hover:text-red-400 px-1">×</button>
              </div>
            );
          })}
          <button onClick={() => up({ hoursOverrides: [...(cfg.hoursOverrides ?? []), { date: "", hours: "" }] })} className="text-sm text-[var(--accent)] hover:underline">
            + הוסף תאריך
          </button>
        </div>
      </Section>

      <Section title="חניה">
        {cfg.parking && (
          <>
            <Field label="תקציר" value={cfg.parking.summary} onChange={(v) => up({ parking: { ...cfg.parking!, summary: v } })} area />
            <Field label="מחיר" value={cfg.parking.price} onChange={(v) => up({ parking: { ...cfg.parking!, price: v } })} />
            <Field label="הוראות הגעה" value={cfg.parking.directions} onChange={(v) => up({ parking: { ...cfg.parking!, directions: v } })} area />
          </>
        )}
      </Section>

      {/* סרגל שמירה דביק בתוך אזור הגלילה - לא מכסה את הניווט */}
      <div className="sticky bottom-0 -mx-3 md:mx-0 bg-[var(--panel)] border-t border-[var(--border)] p-3 flex items-center gap-3 justify-end z-20 rounded-t-xl">
        {msg && <span className={`text-xs ${msg.startsWith("⚠") ? "text-red-400" : "text-[var(--accent)]"}`}>{msg}</span>}
        {dirty && !msg && <span className="text-xs text-amber-400">יש שינויים שלא נשמרו</span>}
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
          className="bg-[var(--accent)] text-[var(--accent-fg)] font-semibold rounded-xl px-5 py-2 text-sm disabled:opacity-50"
        >
          {saving ? "שומר…" : dirty ? "שמור שינויים" : "הכל שמור ✓"}
        </button>
      </div>
    </div>
  );
}
