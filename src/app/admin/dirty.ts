/**
 * דגל שינויים לא-שמורים משותף בין מסכי הפאנל.
 * מסך עם טופס (מידע עסקי) מסמן כאן שיש שינויים; ה-shell בודק לפני מעבר טאב
 * ומזהיר, כדי ששינויים לא יילכו לאיבוד בשקט.
 */
export const unsavedChanges = { current: false as boolean, label: "" };

export function setUnsaved(dirty: boolean, label = "שינויים שלא נשמרו") {
  unsavedChanges.current = dirty;
  unsavedChanges.label = dirty ? label : "";
}
