"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "./types";
import { SectionCard } from "./ui";

/**
 * אנליטיקת הכנסות (שלב 1, קריאה בלבד) - למנהל בלבד. שאילתה לפי-דרישה (לא פולינג):
 * בוחרים טווח, מושכים מהסוכן דרך /api/admin/tabit/revenue. נתונים רגישים, master בלבד.
 * מבוסס ארכיון (הזמנות ששילמו), לכן "אתמול" הוא ברירת המחדל - היום עוד לא חויב.
 */

interface RevenueResult {
  period: string;
  source: string;
  orders: number;
  covers: number;
  revenue_ils: number;
  tips_ils: number;
  avg_check_ils: number;
  per_person_ils: number;
  tip_pct: number;
}
type Range = { key: string; label: string; q: string };
const RANGES: Range[] = [
  { key: "yesterday", label: "אתמול", q: "day=yesterday" },
  { key: "7", label: "7 ימים", q: "days=7" },
  { key: "30", label: "30 ימים", q: "days=30" },
];

const ils = (n: number) => `₪${(n ?? 0).toLocaleString("he-IL")}`;

function Tile({ label, value, tone }: { label: string; value: string; tone?: "accent" }) {
  return (
    <div className="bg-[var(--panel)] border border-[var(--border)] rounded-xl px-3 py-2.5">
      <div className={`text-2xl font-bold font-display ${tone === "accent" ? "text-[var(--accent)]" : "text-[var(--text)]"}`} style={{ fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
      <div className="text-[11px] text-[var(--muted)] mt-0.5">{label}</div>
    </div>
  );
}

export default function Revenue({ token }: { token: string }) {
  const [range, setRange] = useState<Range>(RANGES[0]);
  const [data, setData] = useState<RevenueResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async (r: Range) => {
    setLoading(true);
    setErr("");
    try {
      const d = await api<{ ok: boolean; result?: RevenueResult; error?: string }>(token, `/tabit/revenue?${r.q}`);
      if (d.ok && d.result) setData(d.result);
      else {
        setData(null);
        setErr(d.error || "לא התקבלו נתונים - ייתכן שהגשר לא רץ כרגע");
      }
    } catch (e) {
      setData(null);
      setErr(e instanceof Error ? e.message : "טעינה נכשלה");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load(range);
  }, [load, range]);

  return (
    <div className="space-y-4 max-w-[900px]">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-xl border border-[var(--border)] overflow-hidden">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r)}
              className={`px-4 py-1.5 text-sm ${range.key === r.key ? "bg-[var(--accent)] text-[var(--accent-fg)] font-semibold" : "text-[var(--muted)] hover:text-[var(--text)]"}`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => load(range)}
          disabled={loading}
          className="mr-auto rounded-lg px-2.5 py-1 border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-60 text-sm"
        >
          {loading ? "טוען…" : "↻ רענן"}
        </button>
      </div>

      <SectionCard title="הכנסות" sub={data ? `${data.period} · ${data.orders} חשבונות · ${data.covers} סועדים` : "נמשך מהזמנות ששילמו בטאביט (ארכיון)"}>
        {loading && !data ? (
          <div className="text-sm text-[var(--muted)] text-center py-6">מושך נתונים מהסוכן… (עד 15 שניות אם הוא במצב שקט)</div>
        ) : err ? (
          <div className="text-sm text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">⚠ {err}</div>
        ) : data ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              <Tile label="סה״כ הכנסה" value={ils(data.revenue_ils)} tone="accent" />
              <Tile label="חשבון ממוצע" value={ils(data.avg_check_ils)} />
              <Tile label="ממוצע לסועד" value={ils(data.per_person_ils)} />
              <Tile label="טיפים" value={ils(data.tips_ils)} />
              <Tile label="אחוז טיפ" value={`${data.tip_pct}%`} />
              <Tile label="חשבונות · סועדים" value={`${data.orders} · ${data.covers}`} />
            </div>
            <p className="text-[11px] text-[var(--muted)] text-center">נתון פנימי לצוות בלבד. מבוסס על הזמנות שישבו ושילמו ({data.source}).</p>
          </div>
        ) : (
          <div className="text-sm text-[var(--muted)] text-center py-6">אין נתונים לטווח הזה</div>
        )}
      </SectionCard>
    </div>
  );
}
