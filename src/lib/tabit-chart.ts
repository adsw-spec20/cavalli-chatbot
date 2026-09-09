/**
 * גרף עומס: חישוב סועדים לפי פרוסות זמן + בניית כתובת תמונה זולה (QuickChart).
 *
 * החישוב (coversByTimeSlot) הוא פונקציה טהורה שמשמשת גם את הפאנל (מרנדר עמודות
 * ב-CSS מיידית) וגם את בוט הוואטסאפ (שולח תמונת PNG דרך QuickChart). QuickChart
 * הוא שירות חינמי שמחזיר PNG מ-config של Chart.js בתוך ה-URL - מהיר, זול, בלי
 * תלות בקוד ובלי רינדור בצד השרת.
 */

export interface ChartPoint {
  label: string; // HH:MM
  value: number; // סועדים בפרוסה
}

interface SlotInput {
  time: string; // "HH:MM"
  seats: number;
}

const toMin = (t: string): number => {
  const [h, m] = (t || "").split(":").map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : -1;
};
const toHHMM = (min: number): string =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/**
 * מסכם סועדים לפרוסות של slotMin דקות, מהשעה הראשונה עד האחרונה שיש בהן הזמנה.
 * פרוסות ריקות באמצע נשמרות (כדי שהגרף יראה שקטים אמיתיים).
 */
export function coversByTimeSlot(reservations: SlotInput[], slotMin = 30): ChartPoint[] {
  const valid = reservations.map((r) => ({ min: toMin(r.time), seats: r.seats || 0 })).filter((r) => r.min >= 0);
  if (!valid.length) return [];
  const first = Math.floor(Math.min(...valid.map((r) => r.min)) / slotMin) * slotMin;
  const last = Math.floor(Math.max(...valid.map((r) => r.min)) / slotMin) * slotMin;
  const buckets = new Map<number, number>();
  for (let s = first; s <= last; s += slotMin) buckets.set(s, 0);
  for (const r of valid) {
    const slot = Math.floor(r.min / slotMin) * slotMin;
    buckets.set(slot, (buckets.get(slot) || 0) + r.seats);
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([min, value]) => ({ label: toHHMM(min), value }));
}

/** כתובת תמונת PNG של הגרף מ-QuickChart (לשליחה בוואטסאפ). */
export function quickChartUrl(points: ChartPoint[], title: string): string {
  const config = {
    type: "bar",
    data: {
      labels: points.map((p) => p.label),
      datasets: [{ label: "סועדים", data: points.map((p) => p.value), backgroundColor: "#0C8F91", borderRadius: 4 }],
    },
    options: {
      plugins: { legend: { display: false }, title: { display: true, text: title, font: { size: 16 } } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  };
  return `https://quickchart.io/chart?w=720&h=320&bkg=white&c=${encodeURIComponent(JSON.stringify(config))}`;
}
