"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, relTime } from "./types";
import { SectionCard } from "./ui";

/**
 * מפת רצפה חיה (שלב 1, קריאה בלבד) - למנהל בלבד. מציגה את השולחנות לפי מיקומם
 * הפיזי (קואורדינטות מטאביט) בצבעי סטטוס. נמשך מה-snapshot שהגשר שולח כל 5 דק'
 * (השדה floor) - בלי סבב חי, בלי לשרוף CPU.
 */

interface FloorTable {
  number: number;
  seats: number;
  status: string;
  label: string;
  x?: number;
  y?: number;
  area: string;
  dirty: boolean;
}
interface Floor {
  total: number;
  total_seats: number;
  by_status: Record<string, number>;
  tables: FloorTable[];
}
interface Snapshot {
  generatedAt: number;
  floor?: Floor;
}

// צבע לפי סטטוס טאביט (הצבע הסמנטי נפרד מצבע המותג)
const STATUS_STYLE: Record<string, { dot: string; text: string }> = {
  available: { dot: "bg-emerald-500", text: "text-emerald-400" },
  occupied: { dot: "bg-red-500", text: "text-red-400" },
  seated: { dot: "bg-red-500", text: "text-red-400" },
  reserved: { dot: "bg-amber-500", text: "text-amber-400" },
  dirty: { dot: "bg-stone-500", text: "text-stone-400" },
  cleaning: { dot: "bg-stone-500", text: "text-stone-400" },
};
const FALLBACK = { dot: "bg-zinc-500", text: "text-zinc-400" };
const styleOf = (s: string) => STATUS_STYLE[s] || FALLBACK;

export default function FloorMap({ token }: { token: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await api<{ snapshot: Snapshot | null }>(token, "/tabit");
      setSnapshot(d.snapshot);
      setErr("");
      setLoaded(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "טעינה נכשלה");
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

  const floor = snapshot?.floor;
  const positioned = useMemo(() => (floor?.tables ?? []).filter((t) => t.x != null && t.y != null), [floor]);
  const bbox = useMemo(() => {
    if (!positioned.length) return null;
    const xs = positioned.map((t) => t.x as number);
    const ys = positioned.map((t) => t.y as number);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    return { minX, maxX, minY, maxY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
  }, [positioned]);

  if (!loaded) return <div className="text-sm text-[var(--muted)] p-4">טוען…</div>;
  if (err) return <div className="text-sm text-red-400 p-2">⚠ {err}</div>;

  if (!floor || !floor.tables?.length) {
    return (
      <div className="max-w-[700px]">
        <SectionCard title="מפת רצפה עדיין לא זמינה">
          <div className="text-sm text-[var(--muted)] leading-relaxed space-y-2">
            <p>מפת הרצפה מגיעה מה-snapshot של הגשר המקומי. אם הגשר עודכן זה עתה, המתן עד 5 דקות לרענון הבא, או ודא שהגרסה החדשה של <code className="text-[var(--text)]">agent.js</code> רצה.</p>
          </div>
        </SectionCard>
      </div>
    );
  }

  const statuses = Object.entries(floor.by_status).sort((a, b) => b[1] - a[1]);
  // גובה יחסי לפי יחס ה-bbox, מוגבל כדי שלא יגלוש מדי (המפה של קוואלי מאורכת)
  const aspect = bbox ? bbox.h / bbox.w : 1;

  return (
    <div className="space-y-4 max-w-[900px]">
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="rounded-full px-2.5 py-1 bg-emerald-500/15 text-emerald-400">● עודכן {relTime(snapshot!.generatedAt)}</span>
        <span className="text-[var(--muted)]">{floor.total} שולחנות · {floor.total_seats} מקומות</span>
      </div>

      {/* מקרא */}
      <div className="flex items-center gap-3 flex-wrap text-xs">
        {statuses.map(([status, count]) => {
          const label = floor.tables.find((t) => t.status === status)?.label || status;
          return (
            <span key={status} className="inline-flex items-center gap-1.5 text-[var(--muted)]">
              <span className={`w-2.5 h-2.5 rounded-full ${styleOf(status).dot}`} />
              {label} <b className="text-[var(--text)]" style={{ fontVariantNumeric: "tabular-nums" }}>{count}</b>
            </span>
          );
        })}
      </div>

      <SectionCard title="מפת רצפה חיה" sub="מיקום השולחנות לפי טאביט, בצבעי סטטוס. גלילה לצפייה בכל הרצפה.">
        {bbox && (
          <div className="overflow-auto max-h-[70vh] rounded-xl bg-[var(--panel)] border border-[var(--border)]">
            <div className="relative mx-auto" style={{ width: "100%", maxWidth: 520, paddingBottom: `${Math.min(260, aspect * 100)}%` }}>
              {positioned.map((t) => {
                const left = (((t.x as number) - bbox.minX) / bbox.w) * 100;
                const top = (((t.y as number) - bbox.minY) / bbox.h) * 100;
                const st = styleOf(t.status);
                return (
                  <div
                    key={t.number}
                    className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center"
                    style={{ left: `${left}%`, top: `${top}%` }}
                    title={`שולחן ${t.number} · ${t.seats} מקומות · ${t.label} · ${t.area}`}
                  >
                    <span className={`w-6 h-6 rounded-full ${st.dot} text-white text-[10px] font-bold grid place-items-center shadow`} style={{ fontVariantNumeric: "tabular-nums" }}>
                      {t.number}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <p className="text-[11px] text-[var(--muted)] mt-2 text-center">הכיוון עשוי להיות משוקף מול המציאות (v1) - נכייל מול הצוות אם צריך.</p>
      </SectionCard>
    </div>
  );
}
