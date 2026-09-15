"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, relTime } from "./types";

/**
 * מפת רצפה חיה - כמו בטאביט, אבל בנויה כמפה אמיתית לנייד/טאבלט:
 * - גרירה חופשית לכל כיוון + צביטה לזום (pinch) + גלגלת/דאבל-קליק בדסקטופ.
 * - מיקומים 1:1 מטאביט; השולחנות מצוירים מעט קטנים יחסית למרווחים - אוויר בלי לשנות סידור.
 * - תווית ברורה: מספר השולחן גדול, מספר הסועדים בשורה נפרדת ("X מק׳").
 * - אזור "פנים" מסומן כרצפה מוארת עם מסגרת - הפרדה ויזואלית מ"חוץ".
 * - לחיצה על שולחן פותחת כרטיס; לחיצה באוויר סוגרת אותו.
 * - המקרא הוא גם מסנן: לחיצה על "מעבר לזמן" מדליקה רק אותם.
 *
 * מקור: snapshot.floor (מתעדכן כל 5 דק' מהגשר) + "רענון חי" שמושך עכשיו.
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

const clampNum = (v: number, lo: number, hi: number) => Math.min(Math.max(v, Math.min(lo, hi)), Math.max(lo, hi));

const MAX_SCALE = 3;

// קנה מידה כמו בטאביט: המיקומים 1:1 מהמקור (בהגדלה אחידה), אבל השולחנות מצוירים
// מעט קטנים יחסית למרווחים - כך יש אוויר בין שולחנות צמודים בלי לשנות את הסידור.
const POS_SCALE = 1.1; // יחידת קנבס של טאביט -> פיקסלים (מיקומים)
const SIZE_SCALE = 0.7; // גודל שולחן מצויר, יחסית ליחידות הקנבס
const tableSizePx = (seats: number) => Math.max(30, sizeUnits(seats) * SIZE_SCALE);

export default function FloorMap({ token }: { token: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState("");
  const [areaFilter, setAreaFilter] = useState<"all" | "פנים" | "חוץ">("all");
  const [visFilter, setVisFilter] = useState<Visual | null>(null);
  const [selected, setSelected] = useState<FloorTable | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState("");
  const [zoomPct, setZoomPct] = useState(100);

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

  const bounds = useMemo(() => {
    if (!positioned.length) return null;
    const xs = positioned.map((t) => t.x as number);
    const ys = positioned.map((t) => t.y as number);
    const pad = 60;
    const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
    return { x0: minX, y0: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
  }, [positioned]);

  // לא דוחסים את הרצפה למסך אחד - מנווטים בגרירה ובזום (כמו בטאביט).
  const scaleBase = POS_SCALE;
  const mapW = bounds ? bounds.w * scaleBase : 0;
  const mapH = bounds ? bounds.h * scaleBase : 0;

  /** מלבן אזור ה"פנים" (לפי השולחנות הפנימיים) - ההפרדה הוויזואלית פנים/חוץ */
  const insideRect = useMemo(() => {
    if (!bounds) return null;
    const inside = positioned.filter((t) => t.area === "פנים");
    if (inside.length < 3) return null;
    const outside = positioned.filter((t) => t.area !== "פנים");
    // הכל בפיקסלים של המפה (אחרי scaleBase), כולל הרדיוס המצויר בפועל
    const px = (t: FloorTable) => ((t.x as number) - bounds.x0) * scaleBase;
    const py = (t: FloorTable) => ((t.y as number) - bounds.y0) * scaleBase;
    const rOf = (t: FloorTable) => tableSizePx(t.seats) / 2;
    const minX = Math.min(...inside.map((t) => px(t) - rOf(t)));
    const maxX = Math.max(...inside.map((t) => px(t) + rOf(t)));
    const minY = Math.min(...inside.map((t) => py(t) - rOf(t)));
    const maxY = Math.max(...inside.map((t) => py(t) + rOf(t)));
    // ריפוד לכל צד בנפרד: עד MAX_PAD, אבל הקו נעצר באמצע המרווח אל שולחן החוץ
    // הקרוב באותו צד - כך שולחנות חוץ צמודים (49-51) לא נבלעים חצי בפנים.
    const MAX_PAD = 34;
    const padFor = (gap: number) => clampNum(gap / 2, 2, MAX_PAD);
    let pT = MAX_PAD, pB = MAX_PAD, pL = MAX_PAD, pR = MAX_PAD;
    for (const o of outside) {
      const ox = px(o), oy = py(o), orr = rOf(o);
      const xOverlap = ox + orr > minX && ox - orr < maxX;
      const yOverlap = oy + orr > minY && oy - orr < maxY;
      if (xOverlap && oy < minY) pT = Math.min(pT, padFor(minY - (oy + orr)));
      if (xOverlap && oy > maxY) pB = Math.min(pB, padFor((oy - orr) - maxY));
      if (yOverlap && ox < minX) pL = Math.min(pL, padFor(minX - (ox + orr)));
      if (yOverlap && ox > maxX) pR = Math.min(pR, padFor((ox - orr) - maxX));
    }
    return { left: minX - pL, top: minY - pT, width: maxX - minX + pL + pR, height: maxY - minY + pT + pB };
  }, [positioned, bounds, scaleBase]);

  // ===== מצלמת המפה: גרירה + צביטה + גלגלת, ישירות על ה-DOM (חלק גם בנייד) =====
  const stageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef({ tx: 0, ty: 0, s: 1 });
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ startDist: number; startS: number; startTx: number; startTy: number; midX: number; midY: number } | null>(null);
  const panRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const movedRef = useRef(false);

  /** זום "100%" = המפה בדיוק ברוחב הבמה (כמו שהמנהל רואה בטאביט בנייד) */
  const fitScale = useCallback(() => {
    const cw = stageRef.current?.clientWidth ?? 0;
    return mapW > 0 && cw > 0 ? cw / mapW : 1;
  }, [mapW]);

  const applyView = useCallback(() => {
    const stage = stageRef.current, content = contentRef.current;
    if (!stage || !content) return;
    const v = viewRef.current;
    const cw = stage.clientWidth, ch = stage.clientHeight;
    const fit = fitScale();
    v.s = clampNum(v.s, fit, MAX_SCALE);
    const w = mapW * v.s, h = mapH * v.s;
    // אופקי: כשהמפה לא רחבה מהבמה - נעולה במרכז (אין מה לגלול לצדדים);
    // רק בזום-אין אפשר לגרור, ורק עד קצות המפה בדיוק.
    v.tx = w <= cw + 1 ? (cw - w) / 2 : clampNum(v.tx, cw - w, 0);
    v.ty = h <= ch ? Math.min((ch - h) / 2, 12) : clampNum(v.ty, ch - h - 12, 12);
    content.style.transform = `translate(${v.tx}px, ${v.ty}px) scale(${v.s})`;
    const pct = Math.round((v.s / fit) * 100);
    setZoomPct((p) => (p === pct ? p : pct));
  }, [mapW, mapH, fitScale]);

  useEffect(() => { applyView(); }, [applyView]);

  // תצוגת פתיחה: כל רוחב הרצפה במסך (fit-width), מתחילים מלמעלה
  const didInitRef = useRef(false);
  useEffect(() => {
    if (didInitRef.current || !bounds) return;
    if (!stageRef.current) return;
    didInitRef.current = true;
    viewRef.current = { tx: 0, ty: 12, s: fitScale() };
    applyView();
  }, [bounds, fitScale, applyView]);

  const localPoint = (clientX: number, clientY: number) => {
    const r = stageRef.current?.getBoundingClientRect();
    return { x: clientX - (r?.left ?? 0), y: clientY - (r?.top ?? 0) };
  };

  const zoomAt = useCallback((px: number, py: number, newS: number) => {
    const v = viewRef.current;
    const s = clampNum(newS, fitScale(), MAX_SCALE);
    v.tx = px - ((px - v.tx) / v.s) * s;
    v.ty = py - ((py - v.ty) / v.s) * s;
    v.s = s;
    applyView();
  }, [applyView, fitScale]);

  function beginGesture() {
    const pts = [...pointersRef.current.values()];
    const v = viewRef.current;
    if (pts.length >= 2) {
      const [a, b] = pts;
      pinchRef.current = {
        startDist: Math.hypot(b.x - a.x, b.y - a.y) || 1,
        startS: v.s,
        startTx: v.tx,
        startTy: v.ty,
        midX: (a.x + b.x) / 2,
        midY: (a.y + b.y) / 2,
      };
      panRef.current = null;
    } else if (pts.length === 1) {
      panRef.current = { x: pts[0].x, y: pts[0].y, tx: v.tx, ty: v.ty };
      pinchRef.current = null;
    } else {
      panRef.current = null;
      pinchRef.current = null;
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    const p = localPoint(e.clientX, e.clientY);
    if (pointersRef.current.size === 0) movedRef.current = false;
    pointersRef.current.set(e.pointerId, p);
    beginGesture();
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!pointersRef.current.has(e.pointerId)) return;
    const p = localPoint(e.clientX, e.clientY);
    pointersRef.current.set(e.pointerId, p);
    const v = viewRef.current;
    const pinch = pinchRef.current;
    if (pinch && pointersRef.current.size >= 2) {
      const pts = [...pointersRef.current.values()];
      const [a, b] = pts;
      const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
      const s = clampNum(pinch.startS * (dist / pinch.startDist), fitScale(), MAX_SCALE);
      // העוגן: הנקודה בעולם שהייתה מתחת לאמצע הצביטה נשארת מתחתיו (וגם נגררת איתו)
      v.tx = midX - ((pinch.midX - pinch.startTx) / pinch.startS) * s;
      v.ty = midY - ((pinch.midY - pinch.startTy) / pinch.startS) * s;
      v.s = s;
      movedRef.current = true;
      applyView();
      return;
    }
    const pan = panRef.current;
    if (pan && pointersRef.current.size === 1) {
      const dx = p.x - pan.x, dy = p.y - pan.y;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) movedRef.current = true;
      v.tx = pan.tx + dx;
      v.ty = pan.ty + dy;
      applyView();
    }
  }
  function onPointerEnd(e: React.PointerEvent) {
    pointersRef.current.delete(e.pointerId);
    beginGesture();
  }

  // גלגלת = זום סביב הסמן (חייב non-passive כדי לחסום את גלילת העמוד)
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = localPoint(e.clientX, e.clientY);
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      zoomAt(p.x, p.y, viewRef.current.s * factor);
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  function resetView() {
    viewRef.current = { tx: 0, ty: 12, s: fitScale() };
    applyView();
  }

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
    <div className="space-y-3 max-w-[920px]">
      {/* שורת סטטוס + זום + רענון חי */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="rounded-full px-2.5 py-1 bg-emerald-500/15 text-emerald-400">● עודכן {relTime(snapshot!.generatedAt)}</span>
        <span className="text-[var(--muted)]">{floor.total} שולחנות · {floor.total_seats} מקומות</span>
        {refreshNote && <span className="text-amber-500">{refreshNote}</span>}
        <div className="mr-auto inline-flex items-center gap-1.5">
          <div className="inline-flex rounded-lg border border-[var(--border)] overflow-hidden" title="זום (אפשר גם צביטה במסך מגע)">
            <button
              onClick={() => { const st = stageRef.current; zoomAt((st?.clientWidth ?? 0) / 2, (st?.clientHeight ?? 0) / 2, viewRef.current.s / 1.25); }}
              className="px-2 py-1 text-[var(--muted)] hover:text-[var(--text)]"
            >➖</button>
            <button onClick={resetView} className="px-1.5 py-1 text-[10px] text-[var(--muted)] hover:text-[var(--text)] border-x border-[var(--border)]" style={{ fontVariantNumeric: "tabular-nums" }}>
              {zoomPct}%
            </button>
            <button
              onClick={() => { const st = stageRef.current; zoomAt((st?.clientWidth ?? 0) / 2, (st?.clientHeight ?? 0) / 2, viewRef.current.s * 1.25); }}
              className="px-2 py-1 text-[var(--muted)] hover:text-[var(--text)]"
            >➕</button>
          </div>
          <button
            onClick={liveRefresh}
            disabled={refreshing}
            className="rounded-lg px-2.5 py-1 border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-60"
          >
            {refreshing ? "מושך מטאביט…" : "🔄 רענון חי"}
          </button>
        </div>
      </div>

      {/* מקרא = גם מסנן: לחיצה מדליקה רק את השולחנות במצב הזה */}
      <div className="flex items-center gap-x-2 gap-y-1.5 flex-wrap text-xs">
        {(Object.keys(VISUAL_META) as Visual[]).map((v) =>
          counts[v] > 0 ? (
            <button
              key={v}
              onClick={() => setVisFilter((cur) => (cur === v ? null : v))}
              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 border transition ${
                visFilter === v ? "border-[var(--accent)] text-[var(--text)] bg-[var(--panel2)]" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              <span className={`w-2.5 h-2.5 rounded-full ${VISUAL_META[v].dot}`} />
              {VISUAL_META[v].label} <b className="text-[var(--text)]" style={{ fontVariantNumeric: "tabular-nums" }}>{counts[v]}</b>
            </button>
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

      {/* ===== במת המפה: גרירה חופשית + צביטה לזום ===== */}
      <div
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onPointerLeave={onPointerEnd}
        onDoubleClick={(e) => { const p = localPoint(e.clientX, e.clientY); zoomAt(p.x, p.y, viewRef.current.s * 1.5); }}
        onClick={() => { if (!movedRef.current) setSelected(null); }}
        className="relative mx-5 md:mx-8 bg-[var(--panel)] border border-[var(--border)] rounded-2xl overflow-hidden select-none cursor-grab active:cursor-grabbing"
        style={{ height: "min(72vh, 780px)", minHeight: 420, touchAction: "none" }}
      >
        <div ref={contentRef} className="absolute top-0 left-0" style={{ width: mapW, height: mapH, transformOrigin: "0 0", willChange: "transform" }}>
          {/* רצפת ה"פנים" - הפרדה ויזואלית מהחוץ */}
          {insideRect && (
            <>
              <div
                className="absolute rounded-md border-2"
                style={{
                  left: insideRect.left,
                  top: insideRect.top,
                  width: insideRect.width,
                  height: insideRect.height,
                  borderColor: "color-mix(in srgb, var(--text) 45%, transparent)",
                }}
              />
              <div
                className="absolute text-[11px] font-semibold text-[var(--muted)] bg-[var(--panel)] border border-[var(--border)] rounded-full px-2.5 py-0.5"
                style={{ left: insideRect.left + 10, top: insideRect.top + 8 }}
              >
                🏠 פנים
              </div>
              <div
                className="absolute text-[11px] font-semibold text-[var(--muted)] bg-[var(--panel)] border border-[var(--border)] rounded-full px-2.5 py-0.5"
                style={{ left: 10, top: 8 }}
              >
                🌿 חוץ
              </div>
            </>
          )}

          {positioned.map((t) => {
            const v = visualOf(t);
            const meta = VISUAL_META[v];
            const size = tableSizePx(t.seats);
            const left = ((t.x as number) - bounds.x0) * scaleBase - size / 2;
            const top = ((t.y as number) - bounds.y0) * scaleBase - size / 2;
            const dimmed = (areaFilter !== "all" && t.area !== areaFilter) || (visFilter !== null && v !== visFilter);
            const numPx = Math.max(11, Math.min(17, size * 0.3));
            return (
              <div key={t.number} className={`absolute transition-opacity ${dimmed ? "opacity-20 pointer-events-none" : ""}`} style={{ left, top, width: size }}>
                <button
                  onClick={(e) => { e.stopPropagation(); if (movedRef.current) return; setSelected(t); }}
                  title={`שולחן ${t.number} · ${t.seats} מקומות · ${meta.label}`}
                  className={`relative border-2 ${meta.box} ${t.shape === "round" ? "rounded-full" : "rounded-xl"} ${selected?.number === t.number ? "ring-2 ring-[var(--accent)]" : ""} w-full grid place-items-center shadow-sm transition`}
                  style={{ height: size }}
                >
                  <span className="leading-none text-center">
                    <span className="block font-bold" style={{ fontSize: numPx, fontVariantNumeric: "tabular-nums" }}>{t.number}</span>
                    {size >= 46 && (
                      <span className="block opacity-75 font-medium mt-0.5" style={{ fontSize: Math.max(8, numPx * 0.58) }}>
                        {t.seats} מק׳
                      </span>
                    )}
                  </span>
                  {v === "over" && <span className="absolute -top-1.5 -left-1.5 text-[11px]">⏳</span>}
                </button>
                {t.next && (
                  <div
                    className="absolute text-center text-[var(--muted)] leading-tight truncate"
                    style={{ top: size + 2, insetInlineStart: -size * 0.6, width: size * 2.2, fontSize: 10, fontVariantNumeric: "tabular-nums" }}
                  >
                    {t.next.time} {firstName(t.next.name)}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="absolute bottom-2 inset-x-0 text-center text-[10px] text-[var(--muted)] pointer-events-none">
          גררו להזזה · צבטו או גלגלו לזום · לחיצה על שולחן לפרטים
        </div>
      </div>

      {/* כרטיס פרטי שולחן (נסגר גם בלחיצה באוויר על המפה) */}
      {selected && (
        <div className="fixed inset-x-0 z-50 p-3 pointer-events-none" style={{ bottom: "calc(14px + env(safe-area-inset-bottom, 0px))" }}>
          <div
            className="pointer-events-auto mx-auto max-w-md border-2 rounded-2xl shadow-xl p-4 space-y-2"
            style={{
              background: "color-mix(in srgb, var(--accent) 16%, var(--panel))",
              borderColor: "color-mix(in srgb, var(--accent) 60%, transparent)",
            }}
          >
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
