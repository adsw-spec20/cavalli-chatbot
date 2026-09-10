"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, relTime } from "./types";

/**
 * מפת רצפה חיה - כמו בטאביט: כל שולחן במיקומו האמיתי (אותה מערכת צירים),
 * בצורתו (עגול/מרובע מהקונפיג), בגודל יחסי למספר המקומות, צבוע לפי מצב,
 * עם ההזמנה הקרובה מתחת לשולחן. לחיצה על שולחן פותחת כרטיס פרטים:
 * מי יושב, כמה זמן, מתי צפוי להתפנות, ומה ההזמנה הבאה.
 *
 * מקור: snapshot.floor (מתעדכן כל 5 דק' מהגשר) + כפתור "רענון חי" שמושך עכשיו.
 */

interface FloorNext { time: string; name: string; phone?: string; seats: number }
interface FloorCurrent { name: string; phone?: string; seats: number; seated_min: number; remaining_min: number; flag: string }
interface FloorTable {
  number: number;
  seats: number;
  status: string;
  label: string;
  x?: number;
  y?: number;
  area: string;
  shape?: "round" | "square";
  dirty?: boolean;
  current?: FloorCurrent | null;
  next?: FloorNext | null;
}
interface Floor {
  total: number;
  total_seats: number;
  by_status: Record<string, number>;
  canvas?: { w: number; h: number } | null;
  tables: FloorTable[];
}
interface Snapshot { generatedAt: number; floor?: Floor }

type Visual = "free" | "soon" | "seated" | "ending" | "over" | "dirty";

const VISUAL_META: Record<Visual, { label: string; box: string; dot: string }> = {
  free:   { label: "פנוי",        box: "bg-emerald-500/15 border-emerald-500/60 text-emerald-500", dot: "bg-emerald-500" },
  soon:   { label: "שמור בקרוב",  box: "bg-sky-500/15 border-sky-500/60 text-sky-500",             dot: "bg-sky-500" },
  seated: { label: "תפוס",        box: "bg-zinc-500/25 border-zinc-500/60 text-[var(--muted)]",    dot: "bg-zinc-500" },
  ending: { label: "לקראת סיום",  box: "bg-amber-500/20 border-amber-500/70 text-amber-500",       dot: "bg-amber-500" },
  over:   { label: "מעבר לזמן",   box: "bg-red-500/20 border-red-500/70 text-red-500",             dot: "bg-red-500" },
  dirty:  { label: "בניקוי",      box: "bg-stone-500/20 border-stone-500/50 text-stone-500",       dot: "bg-stone-500" },
};

/** דקות מהחצות, שעון ישראל */
function nowMinIL(): number {
  const t = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}
const toMin = (hhmm: string): number => {
  const [h, m] = (hhmm || "").split(":").map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : -1;
};

function visualOf(t: FloorTable): Visual {
  if (t.current) {
    if (t.current.remaining_min <= 0) return "over";
    if (t.current.remaining_min <= 20) return "ending";
    return "seated";
  }
  if (t.status === "occupied" || t.status === "seated") return "seated";
  if (t.status === "dirty" || t.status === "cleaning") return "dirty";
  if (t.next) {
    const nm = toMin(t.next.time);
    const now = nowMinIL();
    if (nm >= 0 && nm - now >= 0 && nm - now <= 60) return "soon";
  }
  return "free";
}

/** גודל השולחן ביחידות הקנבס של טאביט, לפי מספר מקומות */
function sizeUnits(seats: number): number {
  if (seats <= 2) return 66;
  if (seats <= 4) return 80;
  if (seats <= 6) return 92;
  if (seats <= 8) return 104;
  if (seats <= 11) return 118;
  return 134;
}

function seatedFor(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h} ש' ו-${m} דק'` : `${m} דק'`;
}
const firstName = (n: string) => (n || "").trim().split(/\s+/)[0] || "";

export default function FloorMap({ token }: { token: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState("");
  const [areaFilter, setAreaFilter] = useState<"all" | "פנים" | "חוץ">("all");
  const [selected, setSelected] = useState<FloorTable | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState("");

  const wrapRef = useRef<HTMLDivElement>(null);
  const [wrapW, setWrapW] = useState(560);
  useEffect(() => {
    const measure = () => { if (wrapRef.current) setWrapW(wrapRef.current.clientWidth || 560); };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const load = useCallback(async () => {
    try {
      const d = await api<{ snapshot: Snapshot | null }>(token, "/tabit");
      setSnapshot(d.snapshot);
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "טעינה נכשלה");
    } finally {
      setLoaded(true);
    }
  }, [token]);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 30_000);
    const onWake = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onWake);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [load]);

  /** רענון חי: מבקש מהסוכן snapshot עכשיו (עד ~20 שנ') ואז מושך מחדש */
  async function liveRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshNote("");
    try {
      await api(token, "/tabit/refresh", { method: "POST", body: "{}" });
    } catch {
      setRefreshNote("הסוכן לא זמין כרגע - מוצג העדכון האחרון");
    }
    await load();
    setRefreshing(false);
  }

  const floor = snapshot?.floor;
  const positioned = useMemo(
    () => (floor?.tables ?? []).filter((t) => t.x != null && t.y != null),
    [floor]
  );

  // גבולות הציור: הקנבס של טאביט אם קיים, אחרת מסגרת סביב השולחנות
  const bounds = useMemo(() => {
    if (floor?.canvas?.w && floor?.canvas?.h) return { x0: 0, y0: 0, w: floor.canvas.w, h: floor.canvas.h };
    if (!positioned.length) return null;
    const xs = positioned.map((t) => t.x as number);
    const ys = positioned.map((t) => t.y as number);
    const pad = 90;
    const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
    return { x0: minX, y0: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
  }, [floor, positioned]);

  // רוחב המפה: רספונסיבי, עם רצפה מינימלית כדי שהשולחנות יישארו קריאים בנייד
  const mapW = Math.max(440, Math.min(660, wrapW - 2));
  const scale = bounds ? mapW / bounds.w : 1;
  const mapH = bounds ? bounds.h * scale : 0;

  const counts = useMemo(() => {
    const c: Record<Visual, number> = { free: 0, soon: 0, seated: 0, ending: 0, over: 0, dirty: 0 };
    for (const t of floor?.tables ?? []) c[visualOf(t)]++;
    return c;
  }, [floor]);

  const freeInFilter = useMemo(() => {
    const list = (floor?.tables ?? []).filter((t) => areaFilter === "all" || t.area === areaFilter);
    const free = list.filter((t) => visualOf(t) === "free");
    return { tables: free.length, seats: free.reduce((s, t) => s + t.seats, 0) };
  }, [floor, areaFilter]);

  if (!loaded) return <div className="text-sm text-[var(--muted)] p-4">טוען…</div>;
  if (err) return <div className="text-sm text-red-400 p-2">⚠ {err}</div>;

  if (!floor || !floor.tables?.length || !bounds) {
    return (
      <div className="max-w-[700px] bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-5 text-sm text-[var(--muted)] leading-relaxed">
        מפת הרצפה מגיעה מה-snapshot של הגשר המקומי. אם הסוכן עודכן זה עתה, המתן עד 5 דקות
        או לחץ רענון חי; אם עדיין ריק - ודא שהגרסה החדשה של <code className="text-[var(--text)]">agent.js</code> רצה.
      </div>
    );
  }

  const selVisual = selected ? visualOf(selected) : null;

  return (
    <div className="space-y-3 max-w-[720px]">
      {/* שורת סטטוס + רענון חי */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="rounded-full px-2.5 py-1 bg-emerald-500/15 text-emerald-400">● עודכן {relTime(snapshot!.generatedAt)}</span>
        <span className="text-[var(--muted)]">{floor.total} שולחנות · {floor.total_seats} מקומות</span>
        {refreshNote && <span className="text-amber-500">{refreshNote}</span>}
        <button
          onClick={liveRefresh}
          disabled={refreshing}
          className="mr-auto rounded-lg px-2.5 py-1 border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-60"
        >
          {refreshing ? "מושך מטאביט… (עד 20 שנ')" : "🔄 רענון חי"}
        </button>
      </div>

      {/* מקרא לפי מצב */}
      <div className="flex items-center gap-x-3 gap-y-1.5 flex-wrap text-xs">
        {(Object.keys(VISUAL_META) as Visual[]).map((v) =>
          counts[v] > 0 ? (
            <span key={v} className="inline-flex items-center gap-1.5 text-[var(--muted)]">
              <span className={`w-2.5 h-2.5 rounded-full ${VISUAL_META[v].dot}`} />
              {VISUAL_META[v].label} <b className="text-[var(--text)]" style={{ fontVariantNumeric: "tabular-nums" }}>{counts[v]}</b>
            </span>
          ) : null
        )}
      </div>

      {/* סינון אזור + פנויים */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-xl border border-[var(--border)] overflow-hidden">
          {([["all", "הכל"], ["פנים", "פנים"], ["חוץ", "חוץ"]] as const).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setAreaFilter(k)}
              className={`px-3.5 py-1.5 text-sm ${areaFilter === k ? "bg-[var(--accent)] text-[var(--accent-fg)] font-semibold" : "text-[var(--muted)] hover:text-[var(--text)]"}`}
            >
              {l}
            </button>
          ))}
        </div>
        <span className="text-xs text-[var(--muted)]" style={{ fontVariantNumeric: "tabular-nums" }}>
          {freeInFilter.tables} שולחנות פנויים · {freeInFilter.seats} מקומות
        </span>
      </div>

      {/* המפה */}
      <div ref={wrapRef} className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl overflow-x-auto">
        <div className="relative mx-auto my-3" style={{ width: mapW, height: mapH }}>
          {positioned.map((t) => {
            const v = visualOf(t);
            const meta = VISUAL_META[v];
            const size = Math.max(26, sizeUnits(t.seats) * scale);
            const left = ((t.x as number) - bounds.x0) * scale - size / 2;
            const top = ((t.y as number) - bounds.y0) * scale - size / 2;
            const dimmed = areaFilter !== "all" && t.area !== areaFilter;
            const fontPx = Math.max(9, Math.min(13, size * 0.26));
            return (
              <div
                key={t.number}
                className={`absolute transition-opacity ${dimmed ? "opacity-20 pointer-events-none" : ""}`}
                style={{ left, top, width: size }}
              >
                <button
                  onClick={() => setSelected(t)}
                  title={`שולחן ${t.number} · ${t.seats} מקומות · ${meta.label}`}
                  className={`relative border-2 ${meta.box} ${t.shape === "round" ? "rounded-full" : "rounded-lg"} ${selected?.number === t.number ? "ring-2 ring-[var(--accent)]" : ""} w-full grid place-items-center font-bold shadow-sm hover:shadow transition`}
                  style={{ height: size, fontSize: fontPx, fontVariantNumeric: "tabular-nums" }}
                >
                  {size >= 34 ? `${t.seats}·${t.number}` : t.number}
                  {v === "over" && <span className="absolute -top-1.5 -left-1.5 text-[10px]">⏳</span>}
                </button>
                {t.next && (
                  <div
                    className="absolute text-center text-[var(--muted)] leading-tight truncate"
                    style={{ top: size + 1, insetInlineStart: -size / 2, width: size * 2, fontSize: 9, fontVariantNumeric: "tabular-nums" }}
                  >
                    {t.next.time} {firstName(t.next.name)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* כרטיס פרטי שולחן */}
      {selected && (
        <div className="fixed inset-x-0 bottom-0 z-50 p-3 pointer-events-none">
          <div className="pointer-events-auto mx-auto max-w-md bg-[var(--panel)] border border-[var(--border)] rounded-2xl shadow-xl p-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${VISUAL_META[selVisual!].dot}`} />
              <h3 className="font-semibold font-display text-base">שולחן {selected.number}</h3>
              <span className="text-xs text-[var(--muted)]">{selected.area} · {selected.seats} מקומות · {VISUAL_META[selVisual!].label}</span>
              <button onClick={() => setSelected(null)} className="mr-auto text-[var(--muted)] hover:text-[var(--text)] rounded-lg px-2 py-1 border border-[var(--border)] text-sm">✕</button>
            </div>
            {selected.current ? (
              <div className="text-sm space-y-1">
                <div>
                  יושבים: <b>{selected.current.name || "ללא שם"}</b> · {selected.current.seats} סועדים
                  {selected.current.phone && (
                    <> · <a href={`tel:${selected.current.phone}`} dir="ltr" className="text-[var(--accent)] underline">{selected.current.phone}</a></>
                  )}
                </div>
                <div className="text-[var(--muted)]" style={{ fontVariantNumeric: "tabular-nums" }}>
                  יושבים כבר {seatedFor(selected.current.seated_min)} ·{" "}
                  {selected.current.remaining_min <= 0
                    ? `מעבר לזמן ב-${Math.abs(selected.current.remaining_min)} דק'`
                    : `נותרו ~${selected.current.remaining_min} דק' לזמן שהוקצב`}
                </div>
              </div>
            ) : (
              <div className="text-sm text-[var(--muted)]">{selVisual === "dirty" ? "השולחן בניקוי" : "השולחן פנוי 🙂"}</div>
            )}
            {selected.next && (
              <div className="text-sm border-t border-[var(--border)] pt-2">
                ההזמנה הבאה: <b style={{ fontVariantNumeric: "tabular-nums" }}>{selected.next.time}</b> · {selected.next.name || "ללא שם"} · {selected.next.seats} סועדים
                {selected.next.phone && (
                  <> · <a href={`tel:${selected.next.phone}`} dir="ltr" className="text-[var(--accent)] underline">{selected.next.phone}</a></>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
