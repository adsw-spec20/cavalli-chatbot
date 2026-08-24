"use client";

import { useEffect, useState } from "react";
import {
  api,
  CHANNELS,
  relTime,
  type QuickReply,
  type ChannelHealth,
  type CostSummary,
  type PanelSettings,
  type TeamMemberInfo,
} from "./types";

export default function Settings({
  token,
  isMaster,
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
  isMaster: boolean;
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
  const [costs, setCosts] = useState<CostSummary | null>(null);
  const [saved, setSaved] = useState(false);
  const [saveErr, setSaveErr] = useState("");

  // --- התראות פוש (per-device): המצב נבדק מול המנוי שקיים במכשיר הזה ---
  const [pushState, setPushState] = useState<"checking" | "unsupported" | "off" | "on">("checking");
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMsg, setPushMsg] = useState("");
  const [pushErr, setPushErr] = useState("");

  // --- מנהל בלבד: התראות מייל + ניהול צוות ---
  const [alertEmail, setAlertEmail] = useState("");
  const [alertPhones, setAlertPhones] = useState("");
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [alertSaved, setAlertSaved] = useState(false);
  const [phonesSaved, setPhonesSaved] = useState(false);
  const [phonesErr, setPhonesErr] = useState("");
  const [team, setTeam] = useState<TeamMemberInfo[]>([]);
  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");
  const [teamErr, setTeamErr] = useState("");
  const [namesResult, setNamesResult] = useState("");

  useEffect(() => {
    // מצב התראות הפוש במכשיר הזה. באייפון PushManager קיים רק כשנפתח
    // מהאפליקציה המותקנת במסך הבית - בספארי רגיל יוצג "לא נתמך".
    (async () => {
      if (
        typeof window === "undefined" ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        typeof Notification === "undefined"
      ) {
        setPushState("unsupported");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.getRegistration("/sw.js");
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        setPushState(sub ? "on" : "off");
      } catch {
        setPushState("off");
      }
    })();
  }, []);

  useEffect(() => {
    api<QuickReply[]>(token, "/templates").then(setTemplates).catch(() => {});
    api<ChannelHealth[]>(token, "/health").then(setHealth).catch(() => {});
    if (isMaster) {
      api<CostSummary>(token, "/costs").then(setCosts).catch(() => {});
      api<PanelSettings>(token, "/settings")
        .then((s) => {
          setAlertEmail(s.alertEmail ?? "");
          setAlertPhones(s.alertPhones ?? "");
          setEmailConfigured(!!s.emailConfigured);
        })
        .catch(() => {});
      api<TeamMemberInfo[]>(token, "/team").then(setTeam).catch(() => {});
    }
  }, [token, isMaster]);

  /** המרת מפתח VAPID ציבורי לפורמט ש-subscribe דורש */
  function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(b64);
    const out = new Uint8Array(new ArrayBuffer(raw.length));
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  /** הדלקת התראות פוש במכשיר הזה (חייב להיקרא מלחיצה - דרישת אייפון) */
  async function enablePush() {
    if (pushBusy) return;
    setPushBusy(true);
    setPushErr("");
    setPushMsg("");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        throw new Error("ההרשאה לא אושרה. אפשר לאשר בהגדרות המכשיר > עדכונים (Notifications)");
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const info = await api<{ configured: boolean; publicKey: string }>(token, "/push");
      if (!info.configured || !info.publicKey) throw new Error("התראות פוש לא מוגדרות בשרת");
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(info.publicKey),
      });
      await api(token, "/push", {
        method: "POST",
        body: JSON.stringify({ subscription: sub.toJSON(), name: agentName || undefined }),
      });
      setPushState("on");
      setPushMsg("ההתראות הופעלו במכשיר הזה ✓ שווה לשלוח ניסיון לוודא");
    } catch (e) {
      setPushErr(e instanceof Error ? e.message : "ההפעלה נכשלה, נסו שוב");
    } finally {
      setPushBusy(false);
    }
  }

  /** כיבוי במכשיר הזה: ביטול המנוי בדפדפן + הסרה מהשרת */
  async function disablePush() {
    if (pushBusy) return;
    setPushBusy(true);
    setPushErr("");
    setPushMsg("");
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        await api(token, `/push?endpoint=${encodeURIComponent(sub.endpoint)}`, { method: "DELETE" }).catch(() => {});
        await sub.unsubscribe();
      }
      setPushState("off");
      setPushMsg("ההתראות כובו במכשיר הזה");
    } catch {
      setPushErr("הכיבוי נכשל, נסו שוב");
    } finally {
      setPushBusy(false);
    }
  }

  /** התראת ניסיון למכשיר הזה בלבד */
  async function testPush() {
    if (pushBusy) return;
    setPushBusy(true);
    setPushErr("");
    setPushMsg("");
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (!sub) throw new Error("אין מנוי פעיל במכשיר הזה");
      const res = await api<{ sent: number }>(token, "/push", {
        method: "POST",
        body: JSON.stringify({ test: true, endpoint: sub.endpoint }),
      });
      setPushMsg(res.sent > 0 ? "נשלחה! ההתראה אמורה לקפוץ תוך שניות" : "השליחה לא הצליחה - כבו והדליקו מחדש");
    } catch (e) {
      setPushErr(e instanceof Error ? e.message : "השליחה נכשלה");
    } finally {
      setPushBusy(false);
    }
  }

  async function saveAlertEmail() {
    try {
      await api(token, "/settings", { method: "POST", body: JSON.stringify({ alertEmail }) });
      setAlertSaved(true);
      setTimeout(() => setAlertSaved(false), 1500);
    } catch {
      /* יוצג בכניסה הבאה */
    }
  }

  async function saveAlertPhones() {
    setPhonesErr("");
    try {
      await api(token, "/settings", { method: "POST", body: JSON.stringify({ alertPhones }) });
      setPhonesSaved(true);
      setTimeout(() => setPhonesSaved(false), 1500);
    } catch (e) {
      setPhonesErr(e instanceof Error ? e.message : "שמירה נכשלה");
    }
  }

  async function addMember() {
    setTeamErr("");
    try {
      const next = await api<TeamMemberInfo[]>(token, "/team", {
        method: "POST",
        body: JSON.stringify({ name: newName, code: newCode }),
      });
      setTeam(next);
      setNewName("");
      setNewCode("");
    } catch (e) {
      setTeamErr(e instanceof Error ? e.message : "הוספה נכשלה");
    }
  }

  async function removeMember(m: TeamMemberInfo) {
    if (!confirm(`להסיר את ${m.name}? הגישה שלו לפאנל תבוטל מיידית.`)) return;
    try {
      const next = await api<TeamMemberInfo[]>(token, `/team?id=${encodeURIComponent(m.id)}`, {
        method: "DELETE",
      });
      setTeam(next);
    } catch (e) {
      setTeamErr(e instanceof Error ? e.message : "הסרה נכשלה");
    }
  }

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

  const usd = (n: number) => "$" + (n < 1 ? n.toFixed(3) : n.toFixed(2));

  // ----- עלות לפי טווח תאריכים (מחושב בצד הלקוח מהפירוט היומי) -----
  const [rangeKey, setRangeKey] = useState<"today" | "yesterday" | "7d" | "30d" | "month" | "custom">("7d");
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const ilToday = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
  const shiftDay = (iso: string, n: number) => {
    const t = new Date(iso + "T12:00:00Z");
    t.setUTCDate(t.getUTCDate() + n);
    return t.toISOString().slice(0, 10);
  };
  let rFrom = ilToday;
  let rTo = ilToday;
  if (rangeKey === "yesterday") rFrom = rTo = shiftDay(ilToday, -1);
  else if (rangeKey === "7d") rFrom = shiftDay(ilToday, -6);
  else if (rangeKey === "30d") rFrom = shiftDay(ilToday, -29);
  else if (rangeKey === "month") rFrom = ilToday.slice(0, 8) + "01";
  else if (rangeKey === "custom") {
    rFrom = rangeFrom || ilToday;
    rTo = rangeTo || ilToday;
    if (rFrom > rTo) [rFrom, rTo] = [rTo, rFrom];
  }
  const rangeDays = (costs?.days ?? []).filter((d) => d.date >= rFrom && d.date <= rTo);
  const rangeCost = rangeDays.reduce((s, d) => s + d.cost, 0);
  const rangeReplies = rangeDays.reduce((s, d) => s + d.replies, 0);
  const rangeFree = rangeDays.reduce((s, d) => s + (d.free ?? 0), 0);

  return (
    <div className="max-w-[1700px] grid grid-cols-1 gap-5 xl:grid-cols-2 items-start">
      <div className="space-y-5">
      {/* מד עלות - מנהל בלבד */}
      {isMaster && (
      <section className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-4">
        <h3 className="font-semibold text-sm mb-1">💰 עלות ה-AI</h3>
        <p className="text-xs text-[var(--muted)] mb-3">
          מחושב מהטוקנים האמיתיים של כל קריאה (Claude + תמלול קולי).
        </p>
        {!costs ? (
          <div className="text-xs text-[var(--muted)]">טוען…</div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: "היום", value: usd(costs.today.cost), sub: `${costs.today.replies} תשובות` },
                { label: "החודש", value: usd(costs.monthCost), sub: `${costs.monthReplies} תשובות` },
                { label: "תחזית חודשית", value: usd(costs.projectedMonthCost), sub: "לפי הקצב" },
                { label: "לתשובה", value: usd(costs.avgCostPerReply), sub: "ממוצע" },
              ].map((c) => (
                <div
                  key={c.label}
                  className="bg-[var(--panel2)] border border-[var(--border)] rounded-xl p-2.5"
                >
                  <div className="text-[10px] text-[var(--muted)]">{c.label}</div>
                  <div className="text-lg font-bold tabular-nums">{c.value}</div>
                  <div className="text-[10px] text-[var(--muted)]">{c.sub}</div>
                </div>
              ))}
            </div>
            {costs.days.length > 1 && (
              <div className="mt-3 flex items-end gap-1 h-14">
                {costs.days.slice(-30).map((d) => {
                  const max = Math.max(...costs.days.map((x) => x.cost), 0.0001);
                  return (
                    <div
                      key={d.date}
                      title={`${d.date}: ${usd(d.cost)} (${d.replies} תשובות)`}
                      className="flex-1 bg-[var(--accent)]/60 rounded-t min-h-[2px]"
                      style={{ height: `${Math.max(4, (d.cost / max) * 100)}%` }}
                    />
                  );
                })}
              </div>
            )}
            {costs.today.audioSeconds > 0 && (
              <div className="text-[11px] text-[var(--muted)] mt-2">
                תמלול קולי היום: {Math.round(costs.today.audioSeconds)} שניות אודיו
              </div>
            )}

            {/* עלות לפי טווח תאריכים */}
            <div className="mt-3 border-t border-[var(--border)] pt-3">
              <div className="text-xs font-semibold mb-2">עלות לפי טווח תאריכים</div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {(
                  [
                    ["today", "היום"],
                    ["yesterday", "אתמול"],
                    ["7d", "7 ימים"],
                    ["30d", "30 ימים"],
                    ["month", "החודש"],
                    ["custom", "מותאם"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setRangeKey(k)}
                    className={`text-xs rounded-full px-3 py-1 border ${
                      rangeKey === k
                        ? "bg-[var(--accent)] text-[var(--accent-fg)] border-transparent font-semibold"
                        : "text-[var(--muted)] border-[var(--border)] hover:text-[var(--text)]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {rangeKey === "custom" && (
                <div className="flex items-center gap-2 mb-2 text-xs flex-wrap">
                  <label className="flex items-center gap-1.5">
                    מ-
                    <input
                      type="date"
                      value={rangeFrom}
                      max={ilToday}
                      onChange={(e) => setRangeFrom(e.target.value)}
                      className="bg-[var(--panel2)] border border-[var(--border)] rounded-lg px-2 py-1 outline-none focus:border-[var(--accent)]"
                    />
                  </label>
                  <label className="flex items-center gap-1.5">
                    עד
                    <input
                      type="date"
                      value={rangeTo}
                      max={ilToday}
                      onChange={(e) => setRangeTo(e.target.value)}
                      className="bg-[var(--panel2)] border border-[var(--border)] rounded-lg px-2 py-1 outline-none focus:border-[var(--accent)]"
                    />
                  </label>
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-[var(--panel2)] border border-[var(--border)] rounded-xl p-2.5">
                  <div className="text-[10px] text-[var(--muted)]">עלות בטווח</div>
                  <div className="text-lg font-bold tabular-nums" data-testid="range-cost">{usd(rangeCost)}</div>
                </div>
                <div className="bg-[var(--panel2)] border border-[var(--border)] rounded-xl p-2.5">
                  <div className="text-[10px] text-[var(--muted)]">תשובות בתשלום</div>
                  <div className="text-lg font-bold tabular-nums">{rangeReplies}</div>
                  {rangeFree > 0 && (
                    <div className="text-[10px] text-emerald-400">
                      + {rangeFree} חינמיות (~{usd(rangeFree * (costs?.avgCostPerReply || 0.017))} נחסכו)
                    </div>
                  )}
                </div>
                <div className="bg-[var(--panel2)] border border-[var(--border)] rounded-xl p-2.5">
                  <div className="text-[10px] text-[var(--muted)]">ממוצע לתשובה</div>
                  <div className="text-lg font-bold tabular-nums">{rangeReplies ? usd(rangeCost / rangeReplies) : "-"}</div>
                </div>
              </div>
              <div className="text-[10px] text-[var(--muted)] mt-1.5">
                {rFrom === rTo ? rFrom : `${rFrom} עד ${rTo}`} · פירוט יומי נשמר כ-3 חודשים אחורה
              </div>
            </div>
          </>
        )}
      </section>
      )}

      {/* ניהול צוות - מנהל בלבד */}
      {isMaster && (
        <section className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-4">
          <h3 className="font-semibold text-sm mb-1">👥 צוות</h3>
          <p className="text-xs text-[var(--muted)] mb-3">
            כל איש צוות נכנס לפאנל עם השם והסיסמה האישית שלו (במקום קוד הגישה הראשי). הסרה מבטלת את הגישה מיידית.
            אחרי 8 ניסיונות כושלים החשבון ננעל לרבע שעה.
          </p>
          <div className="space-y-2 mb-3">
            {team.length === 0 && <div className="text-xs text-[var(--muted)]">עדיין לא הוגדרו אנשי צוות.</div>}
            {team.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-2 bg-[var(--panel2)] border border-[var(--border)] rounded-xl px-3 py-2">
                <div>
                  <div className="text-sm font-medium">{m.name}</div>
                  <div className="text-[10px] text-[var(--muted)]">
                    {m.lastLoginAt ? `כניסה אחרונה: ${relTime(m.lastLoginAt)}` : "עוד לא נכנס"}
                  </div>
                </div>
                <button onClick={() => removeMember(m)} className="text-xs text-red-400 border border-red-500/30 rounded-lg px-2.5 py-1 hover:bg-red-500/10">
                  הסר
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2 flex-wrap">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="שם (למשל: איתי)"
              className="flex-1 min-w-32 bg-[var(--panel2)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            />
            <input
              value={newCode}
              onChange={(e) => setNewCode(e.target.value.slice(0, 40))}
              onKeyDown={(e) => e.key === "Enter" && addMember()}
              placeholder="סיסמה (6+ תווים)"
              dir="ltr"
              className="w-44 bg-[var(--panel2)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            />
            <button onClick={addMember} className="bg-[var(--accent)] text-[var(--accent-fg)] text-sm font-semibold rounded-xl px-4 py-2">
              הוסף
            </button>
          </div>
          {teamErr && <div className="text-xs text-red-400 mt-2">⚠ {teamErr}</div>}
        </section>
      )}

      {/* רענון שמות לקוחות - מנהל בלבד */}
      {isMaster && (
        <section className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-sm">רענון שמות לקוחות</h3>
              <p className="text-xs text-[var(--muted)]">
                מנסה לשלוף מחדש שמות ללקוחות שמופיעים כ&quot;לקוח&quot; (מסנג&apos;ר/אינסטגרם).
                דורש שההרשאה Business Asset User Profile Access תאושר ע&quot;י מטא.
              </p>
            </div>
            <button
              onClick={async () => {
                setNamesResult("מרענן…");
                try {
                  const r = await api<{ checked: number; updated: number }>(token, "/refresh-names", { method: "POST" });
                  setNamesResult(`נבדקו ${r.checked}, עודכנו ${r.updated}${r.updated === 0 && r.checked > 0 ? " (כנראה ההרשאה עוד לא אושרה)" : ""}`);
                } catch {
                  setNamesResult("הרענון נכשל");
                }
              }}
              className="shrink-0 text-xs bg-[var(--accent)] text-[var(--accent-fg)] rounded-lg px-3 py-2 font-semibold"
            >
              רענן שמות
            </button>
          </div>
          {namesResult && <div className="text-xs text-[var(--muted)] mt-2">{namesResult}</div>}
        </section>
      )}

      {/* התראות במייל - מנהל בלבד */}
      {isMaster && (
        <section className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-semibold text-sm">📧 התראות במייל</h3>
            {alertSaved && <span className="text-xs text-emerald-400">נשמר ✓</span>}
          </div>
          <p className="text-xs text-[var(--muted)] mb-2">
            הסלמות דחופות, שאלות חדשות לבוט ודוח יומי. אפשר כמה כתובות, מופרדות בפסיק.
          </p>
          <div className="flex gap-2">
            <input
              value={alertEmail}
              onChange={(e) => setAlertEmail(e.target.value)}
              placeholder="owner@example.com, manager@example.com"
              dir="ltr"
              className="flex-1 bg-[var(--panel2)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            />
            <button onClick={saveAlertEmail} className="bg-[var(--accent)] text-[var(--accent-fg)] text-sm font-semibold rounded-xl px-4 py-2">
              שמור
            </button>
          </div>
          <div className={`text-[11px] mt-2 ${emailConfigured ? "text-emerald-400" : "text-amber-400"}`}>
            {emailConfigured
              ? "✓ שירות המייל מחובר ופעיל"
              : "⚠ שירות המייל עוד לא חובר (חסר מפתח Resend) - ההגדרה תישמר ותופעל ברגע שיחובר"}
          </div>
        </section>
      )}

      {/* התראות בוואטסאפ לצוות - מנהל בלבד */}
      {isMaster && (
        <section className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-semibold text-sm">💬 התראות בוואטסאפ לצוות</h3>
            {phonesSaved && <span className="text-xs text-emerald-400">נשמר ✓</span>}
          </div>
          <p className="text-xs text-[var(--muted)] mb-2">
            הסלמות, בקשות הזמנה ותקלות מערכת נשלחות בוואטסאפ מהמספר העסקי לכל מספר שכאן.
            אפשר כמה מספרים, מופרדים בפסיק (למשל 0501234567).
          </p>
          <div className="flex gap-2">
            <input
              value={alertPhones}
              onChange={(e) => setAlertPhones(e.target.value)}
              placeholder="0501234567, 0529876543"
              dir="ltr"
              inputMode="tel"
              className="flex-1 bg-[var(--panel2)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            />
            <button onClick={saveAlertPhones} className="bg-[var(--accent)] text-[var(--accent-fg)] text-sm font-semibold rounded-xl px-4 py-2">
              שמור
            </button>
          </div>
          {phonesErr && <div className="text-[11px] mt-2 text-red-400">⚠ {phonesErr}</div>}
        </section>
      )}

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
      </div>

      <div className="space-y-5">
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
        {isMaster ? (
          <>
            <p className="text-xs text-[var(--muted)] mb-2">יופיע ליד התשובות שאתה שולח, כדי שהצוות ידע מי ענה.</p>
            <input
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              placeholder="לדוגמה: איתי"
              className="bg-[var(--panel2)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm outline-none focus:border-[var(--accent)] w-48"
            />
          </>
        ) : (
          <p className="text-sm">
            מחובר/ת בתור <b className="text-[var(--accent)]">{agentName}</b>
            <span className="text-xs text-[var(--muted)]"> · השם נקבע בכניסה ומופיע על כל תשובה שלך</span>
          </p>
        )}
      </section>

      {/* התראות */}
      <section className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-4 space-y-3">
        {/* התראות פוש - עובדות גם כשהאפליקציה סגורה */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-sm">🔔 התראות למכשיר הזה</h3>
              <p className="text-xs text-[var(--muted)]">
                קופצות גם כשהאפליקציה סגורה: שיחה שעוברת לנציג, הזמנה חדשה או תקלה.
              </p>
            </div>
            {pushState === "on" ? (
              <span className="shrink-0 text-xs text-emerald-400">פעיל ✓</span>
            ) : pushState === "off" ? (
              <button
                onClick={enablePush}
                disabled={pushBusy}
                className="shrink-0 text-xs bg-[var(--accent)] text-[var(--accent-fg)] rounded-lg px-3 py-1.5 font-semibold disabled:opacity-60"
              >
                {pushBusy ? "מפעיל…" : "הפעל"}
              </button>
            ) : pushState === "unsupported" ? (
              <span className="shrink-0 text-[11px] text-[var(--muted)] text-left max-w-[130px]">
                זמין רק מהאפליקציה שמותקנת במסך הבית
              </span>
            ) : null}
          </div>
          {pushState === "on" && (
            <div className="flex gap-2">
              <button
                onClick={testPush}
                disabled={pushBusy}
                className="text-xs border border-[var(--border)] rounded-lg px-3 py-1.5 hover:bg-[var(--panel2)] disabled:opacity-60"
              >
                שלח התראת ניסיון
              </button>
              <button
                onClick={disablePush}
                disabled={pushBusy}
                className="text-xs text-[var(--muted)] rounded-lg px-3 py-1.5 hover:bg-[var(--panel2)] disabled:opacity-60"
              >
                כבה במכשיר הזה
              </button>
            </div>
          )}
          {pushMsg && <p className="text-xs text-emerald-400">{pushMsg}</p>}
          {pushErr && <p className="text-xs text-red-400">⚠ {pushErr}</p>}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--border)] pt-3">
          <div>
            <h3 className="font-semibold text-sm">התראות דפדפן</h3>
            <p className="text-xs text-[var(--muted)]">התראה כשמגיעה הסלמה חדשה (כשהפאנל פתוח).</p>
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
          onClick={onLogout}
          className="text-xs text-red-400 border border-red-500/30 rounded-lg px-3 py-1.5 hover:bg-red-500/10"
        >
          התנתק מהפאנל
        </button>
      </section>
      </div>
    </div>
  );
}
