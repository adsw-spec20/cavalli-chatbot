"use client";

import type { ReactNode } from "react";

/**
 * מעטפת סקשן אחידה לכל מסכי הפאנל: כותרת בפונט התצוגה, תגית מונה, הסבר קצר
 * ופעולות בצד - והתוכן בתוך כרטיס אחד מכיל. נותן לכל מסך מבנה "אפוי" ואחיד.
 * שכבות: הכרטיס על --panel, ופריטים בתוכו על --panel2 (היררכיית משטחים ברורה).
 */
export function SectionCard({
  title,
  badge,
  badgeCls,
  sub,
  actions,
  children,
}: {
  title: string;
  badge?: ReactNode;
  badgeCls?: string;
  sub?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl overflow-hidden">
      <header className="px-4 pt-3 pb-2.5 border-b border-[var(--border)]">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="font-semibold font-display text-base">{title}</h2>
          {badge != null && (
            <span className={`text-xs rounded-full px-2 py-0.5 ${badgeCls ?? "bg-[var(--panel2)] text-[var(--muted)]"}`}>{badge}</span>
          )}
          {actions && <div className="mr-auto">{actions}</div>}
        </div>
        {sub && <p className="text-xs text-[var(--muted)] mt-1">{sub}</p>}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}
