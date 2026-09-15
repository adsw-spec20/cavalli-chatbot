"use client";

import { useEffect, useRef, useState } from "react";

/**
 * גובה חי לקופסת צ'אט: ממלא את המסך הנראה מהנקודה שבה הקופסה מתחילה ועד
 * לסרגל התחתון של המובייל. נמדד מה-DOM עצמו (לא קבועים) ולכן שורד באנרים
 * שנדחפים מעל, מקלדת פתוחה (ה-visualViewport מתכווץ) וסיבוב מסך -
 * שדה ההקלדה תמיד נשאר גלוי.
 */
export function useChatBoxHeight() {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      const vv = window.visualViewport;
      const vh = vv ? vv.height : window.innerHeight;
      const nav = document.querySelector<HTMLElement>('nav[aria-label="ניווט ראשי"]');
      const navH = nav?.offsetHeight ?? 0;
      const top = el.getBoundingClientRect().top;
      setHeight(Math.max(220, Math.round(vh - top - navH - 10)));
    };
    measure();
    // מדידה נוספת אחרי שהפריסה מתייצבת (פונטים/באנרים נטענים באיחור קל)
    const t = setTimeout(measure, 400);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", measure);
    window.addEventListener("resize", measure);
    return () => {
      clearTimeout(t);
      vv?.removeEventListener("resize", measure);
      window.removeEventListener("resize", measure);
    };
  }, []);

  return { ref, height };
}
