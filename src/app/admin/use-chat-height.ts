"use client";

import { useEffect, useRef, useState } from "react";

/**
 * גובה חי לקופסת צ'אט + "מצב הקלדה" למובייל.
 *
 * מצב רגיל: הקופסה ממלאת את המסך הנראה מהנקודה שבה היא מתחילה ועד הסרגל
 * התחתון - נמדד מה-DOM (שורד באנרים, סיבוב מסך וכו').
 *
 * מצב הקלדה (overlay): כשמקלדת המובייל נפתחת אין מספיק מקום לכותרות +
 * צ'אט + סרגל ביחד, אז הצ'אט עובר לתפוס את כל השטח הנראה מעל המקלדת -
 * בדיוק כמו וואטסאפ. כשהמקלדת נסגרת הכל חוזר למקומו.
 */
export function useChatBoxHeight() {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ height: number | null; overlay: boolean }>({ height: null, overlay: false });

  useEffect(() => {
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      const vv = window.visualViewport;
      const vh = vv ? vv.height : window.innerHeight;
      // מקלדת פתוחה = ה-viewport הנראה נמוך משמעותית מהחלון (iOS לא מקטין את החלון)
      const keyboardOpen = window.innerWidth < 768 && !!vv && window.innerHeight - vv.height > 150;
      if (keyboardOpen) {
        setState({ height: Math.max(180, Math.round(vh)), overlay: true });
        return;
      }
      const nav = document.querySelector<HTMLElement>('nav[aria-label="ניווט ראשי"]');
      const navH = nav?.offsetHeight ?? 0;
      const top = el.getBoundingClientRect().top;
      setState({ height: Math.max(220, Math.round(vh - top - navH - 10)), overlay: false });
    };
    measure();
    // מדידה נוספת אחרי שהפריסה מתייצבת (פונטים/באנרים נטענים, אנימציית מקלדת)
    const t = setTimeout(measure, 400);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", measure);
    vv?.addEventListener("scroll", measure);
    window.addEventListener("resize", measure);
    return () => {
      clearTimeout(t);
      vv?.removeEventListener("resize", measure);
      vv?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, []);

  return { ref, height: state.height, overlay: state.overlay };
}
