"use client";

import { useEffect, useState } from "react";
import { upload } from "@vercel/blob/client";
import { api, type MediaItem } from "./types";

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

export default function Media({ token }: { token: string }) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [msg, setMsg] = useState("");
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    api<MediaItem[]>(token, "/media").then(setItems).catch(() => {});
  }, [token]);

  async function uploadFile(i: number, id: string, file: File) {
    setUploadingId(id);
    setMsg("");
    try {
      // העלאה ישירה מהדפדפן ל-Blob (עוקפת את מגבלת גודל הבקשה של פונקציות שרת)
      const blob = await upload(`media/${file.name}`, file, {
        access: "public",
        handleUploadUrl: "/api/admin/media/upload",
        clientPayload: token,
      });
      const type = file.type.startsWith("video") ? "video" : "image";
      const next = [...items];
      next[i] = { ...next[i], url: blob.url, type };
      await save(next);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "העלאה נכשלה");
    } finally {
      setUploadingId(null);
    }
  }

  async function save(next: MediaItem[]) {
    setItems(next);
    try {
      await api(token, "/media", { method: "PUT", body: JSON.stringify(next) });
      setMsg("נשמר ✓");
      setTimeout(() => setMsg(""), 1500);
    } catch (e) {
      setMsg(`⚠ ${e instanceof Error ? e.message : "שמירה נכשלה"}`);
    }
  }

  function update(i: number, patch: Partial<MediaItem>) {
    const next = [...items];
    next[i] = { ...next[i], ...patch };
    setItems(next);
  }

  async function copyUrl(url: string, id: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500);
    } catch {
      /* דפדפן ישן - מתעלמים */
    }
  }

  return (
    <div className="max-w-[1700px] space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-xs text-[var(--muted)]">
          לכל פריט תן שם ומילות מפתח (כדי שהבוט יבין מתי לשלוח), והעלה קובץ מהמכשיר. לדוגמה: סרטון הדרך לחניה, תמונות גינת הילדים, תמונת מנה.
        </p>
        {msg && <span className="text-xs text-emerald-400">{msg}</span>}
      </div>

      <div className="grid xl:grid-cols-2 gap-3 items-start">
        {items.length === 0 && (
          <div className="xl:col-span-2 bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-6 text-center text-sm text-[var(--muted)]">
            עדיין אין מדיה. הוסף פריט ראשון 👇
          </div>
        )}
        {items.map((m, i) => (
          <div key={m.id} className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-3 flex gap-3">
            <div className="w-20 h-20 shrink-0 rounded-lg overflow-hidden bg-[var(--panel2)] grid place-items-center">
              {m.url ? (
                m.type === "video" ? (
                  <video src={m.url} className="w-full h-full object-cover" muted />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.url} alt={m.label} className="w-full h-full object-cover" />
                )
              ) : (
                <span className="text-[var(--muted)] text-xs">תצוגה</span>
              )}
            </div>
            <div className="flex-1 space-y-1.5">
              <div className="flex gap-2">
                <input
                  value={m.label}
                  placeholder="שם (למשל: הדרך לחניה)"
                  onChange={(e) => update(i, { label: e.target.value })}
                  onBlur={() => save(items)}
                  className="flex-1 bg-[var(--panel2)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm outline-none"
                />
                <select
                  value={m.type}
                  onChange={(e) => {
                    const next = [...items];
                    next[i] = { ...next[i], type: e.target.value as "image" | "video" };
                    save(next);
                  }}
                  className="bg-[var(--panel2)] border border-[var(--border)] rounded-lg px-2 text-sm outline-none"
                >
                  <option value="image">תמונה</option>
                  <option value="video">סרטון</option>
                </select>
              </div>
              <input
                value={m.keywords}
                placeholder="מילות מפתח (חניה, איך מגיעים)"
                onChange={(e) => update(i, { keywords: e.target.value })}
                onBlur={() => save(items)}
                className="w-full bg-[var(--panel2)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs outline-none"
              />
              <div className="flex items-center gap-2 flex-wrap">
                <label className={`shrink-0 text-xs font-medium rounded-lg px-3 py-1.5 cursor-pointer ${uploadingId === m.id ? "bg-[var(--panel2)] text-[var(--muted)]" : "bg-[var(--accent)] text-[var(--accent-fg)]"}`}>
                  {uploadingId === m.id ? "מעלה…" : "📤 העלה מהמכשיר"}
                  <input
                    type="file"
                    accept="image/*,video/*"
                    className="hidden"
                    disabled={uploadingId === m.id}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadFile(i, m.id, f);
                      e.target.value = "";
                    }}
                  />
                </label>
                {m.url && (
                  <>
                    <span className="text-[10px] text-emerald-400">קובץ נשמר ✓</span>
                    <button
                      onClick={() => copyUrl(m.url, m.id)}
                      className="text-[10px] text-[var(--muted)] hover:text-[var(--text)] border border-[var(--border)] rounded px-1.5 py-0.5"
                    >
                      {copiedId === m.id ? "הועתק ✓" : "העתק קישור"}
                    </button>
                  </>
                )}
              </div>
              {/* עריכת URL ידנית - מוצנע, רק למי שבאמת צריך */}
              <details>
                <summary className="text-[10px] text-[var(--muted)] cursor-pointer">קישור ידני (מתקדם)</summary>
                <input
                  value={m.url}
                  placeholder="הדבק קישור (URL)"
                  onChange={(e) => update(i, { url: e.target.value })}
                  onBlur={() => save(items)}
                  className="mt-1 w-full bg-[var(--panel2)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-[11px] outline-none"
                  dir="ltr"
                />
              </details>
            </div>
            <button
              onClick={() => confirm(`למחוק את "${m.label || "הפריט"}"? הבוט יפסיק לשלוח אותו.`) && save(items.filter((_, j) => j !== i))}
              className="text-[var(--muted)] hover:text-red-400 px-2 min-w-9"
              aria-label="מחק פריט מדיה"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={() => setItems([...items, { id: uid(), label: "", keywords: "", url: "", type: "image" }])}
        className="text-sm bg-[var(--accent)] text-[var(--accent-fg)] font-semibold rounded-xl px-4 py-2"
      >
        + הוסף מדיה
      </button>
    </div>
  );
}
