"use client";

/**
 * "מוח הבוט" - מסך שליטה ובקרה על כל מה שהבוט יודע. מנהל ראשי בלבד.
 *
 * קריאה, חיפוש רוחבי, משקל בטוקנים, גלאי סתירות - ועריכה מלאה.
 *
 * ⚠️ העריכה אמיתית ומיידית: טקסט שנשמר כאן נכנס ל-System Prompt שנשלח למודל
 * ולתשובות החינמיות שנשלחות ללקוח, כבר בהודעה הבאה. אין "מאחורי הקלעים".
 * ברירת המחדל שבקוד נשמרת תמיד וניתן לחזור אליה בלחיצה.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

interface Item {
  id: string;
  title: string;
  body: string;
  chars: number;
  tokens: number;
  origin: "code" | "config" | "learned" | "media" | "runtime";
  editable: boolean;
  edited?: boolean;
  defaultText?: string;
  stale?: boolean;
  matchNote?: string;
  dynamic?: boolean;
  variantCount?: number;
}
interface Layer { key: string; title: string; note: string; items: Item[]; tokens: number }
interface Conflict { severity: "high" | "medium"; topic: string; detail: string; where: string[] }
interface Match { layer: string; id: string; title: string; excerpt: string }
interface Snapshot {
  layers: Layer[];
  totalTokens: number;
  estCostPerMessage: number;
  conflicts: Conflict[];
  matches?: Match[];
  editedCount: number;
  staleIds: string[];
  generatedAt: number;
}

const ORIGIN_LABEL: Record<Item["origin"], string> = {
  code: "בקוד",
  config: "מידע עסקי",
  learned: "ידע נלמד",
  media: "מדיה",
  runtime: "בזמן אמת",
};

export default function Brain({ token }: { token: string }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [openLayer, setOpenLayer] = useState<string>("canned");
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState("");

  const load = useCallback(async (q = "") => {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch(`/api/admin/brain${q ? `?q=${encodeURIComponent(q)}` : ""}`, {
        headers: { "x-admin-token": token },
      });
      if (!r.ok) throw new Error(r.status === 401 ? "נדרשת הרשאת מנהל ראשי" : `שגיאה ${r.status}`);
      setSnap(await r.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "שגיאה בטעינה");
    } finally {
      setLoading(false);
      setSearching(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  // שמירה: הטקסט נכנס לתוקף בהודעה הבאה של הבוט. base הוא ברירת המחדל שממנה
  // נערך - הוא העוגן שמאפשר לזהות אם הקוד השתנה מתחת לעריכה.
  const save = async (item: Item, text: string) => {
    setSaving(true);
    setSaved("");
    try {
      const base = item.defaultText ?? item.body;
      const r = await fetch("/api/admin/brain", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-admin-token": token },
        body: JSON.stringify({ id: item.id, text, base }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "שמירה נכשלה");
      setSaved(text.trim() ? "נשמר. הבוט משתמש בזה מההודעה הבאה." : "אופס לברירת המחדל.");
      setDraft(null);
      await load(query);
    } catch (e) {
      setSaved(e instanceof Error ? e.message : "שמירה נכשלה");
    } finally {
      setSaving(false);
    }
  };

  const current = useMemo(() => {
    if (!snap || !selected) return null;
    for (const l of snap.layers) {
      const it = l.items.find((i) => i.id === selected);
      if (it) return { item: it, layer: l };
    }
    return null;
  }, [snap, selected]);

  useEffect(() => { setDraft(null); setSaved(""); }, [selected]);

  const runSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearching(true);
    void load(query);
  };

  if (loading && !snap) return <div style={{ padding: 24, color: "#666" }}>טוען את המוח...</div>;
  if (err) return <div style={{ padding: 24, color: "#b3402e" }}>{err}</div>;
  if (!snap) return null;

  const high = snap.conflicts.filter((c) => c.severity === "high").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* סרגל עליון: משקל, עלות, סתירות */}
      <div style={S.topbar}>
        <div>
          <div style={S.statBig}>{snap.totalTokens.toLocaleString()}</div>
          <div style={S.statLabel}>טוקנים במוח</div>
        </div>
        <div>
          <div style={S.statBig}>${snap.estCostPerMessage.toFixed(3)}</div>
          <div style={S.statLabel}>עלות הפרומפט להודעה</div>
        </div>
        <div>
          <div style={{ ...S.statBig, color: snap.conflicts.length ? "#b3402e" : "#2c6e49" }}>
            {snap.conflicts.length}
          </div>
          <div style={S.statLabel}>סתירות{high ? ` (${high} חמורות)` : ""}</div>
        </div>
        <form onSubmit={runSearch} style={{ marginInlineStart: "auto", display: "flex", gap: 6 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חיפוש בכל המוח (למשל: פיקדון)"
            style={S.search}
          />
          <button type="submit" style={S.btn} disabled={searching}>
            {searching ? "מחפש..." : "חפש"}
          </button>
          {snap.matches && (
            <button type="button" style={S.btnGhost} onClick={() => { setQuery(""); void load(); }}>
              נקה
            </button>
          )}
        </form>
      </div>

      {/* סתירות */}
      {snap.conflicts.length > 0 && (
        <div style={S.conflictBox}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>⚠️ סתירות בין מקורות הידע</div>
          {snap.conflicts.map((c, i) => (
            <div key={i} style={{ ...S.conflict, borderInlineStartColor: c.severity === "high" ? "#b3402e" : "#a66a00" }}>
              <div style={{ fontWeight: 700 }}>{c.topic}</div>
              <div style={{ fontSize: 13, color: "#555", margin: "2px 0" }}>{c.detail}</div>
              <div style={{ fontSize: 12, color: "#777" }}>איפה: {c.where.join("  ·  ")}</div>
            </div>
          ))}
        </div>
      )}

      {/* תוצאות חיפוש */}
      {snap.matches && (
        <div style={S.card}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>
            נמצאו {snap.matches.length} אזכורים של &quot;{query}&quot;
          </div>
          {snap.matches.length === 0 && <div style={{ color: "#777" }}>אין אזכורים. זה אומר שהבוט לא יודע על זה כלום.</div>}
          {snap.matches.map((m, i) => (
            <div key={i} style={S.match} onClick={() => { setSelected(m.id); }}>
              <div style={{ fontSize: 12, color: "#777" }}>{m.layer}</div>
              <div style={{ fontWeight: 600 }}>{m.title}</div>
              <div style={{ fontSize: 13, color: "#555" }}>...{m.excerpt}...</div>
            </div>
          ))}
        </div>
      )}

      {/* גוף: ניווט + תוכן */}
      <div style={S.body}>
        <div style={S.nav}>
          {snap.layers.map((l) => (
            <div key={l.key}>
              <button
                style={{ ...S.layerBtn, background: openLayer === l.key ? "#eef1ee" : "transparent" }}
                onClick={() => setOpenLayer(openLayer === l.key ? "" : l.key)}
              >
                <span>{openLayer === l.key ? "▾" : "▸"} {l.title}</span>
                <span style={S.count}>{l.items.length}</span>
              </button>
              {openLayer === l.key && (
                <div style={{ paddingInlineStart: 10 }}>
                  <div style={S.layerNote}>{l.note}</div>
                  {l.items.map((it) => (
                    <button
                      key={it.id}
                      onClick={() => setSelected(it.id)}
                      style={{ ...S.itemBtn, background: selected === it.id ? "#e3ece6" : "transparent" }}
                      title={it.title}
                    >
                      <span style={S.itemTitle}>{it.title}</span>
                      {it.tokens > 0 && <span style={S.tok}>{it.tokens}</span>}
                    </button>
                  ))}
                  {l.items.length === 0 && <div style={S.layerNote}>אין פריטים</div>}
                </div>
              )}
            </div>
          ))}
        </div>

        <div style={S.content}>
          {!current && (
            <div style={{ color: "#777", padding: 20, lineHeight: 1.8 }}>
              בחר פריט מהצד כדי לראות בדיוק מה הבוט יודע עליו.
              <br /><br />
              <b>טיפ:</b> החיפוש למעלה עובר על כל השכבות יחד. אם תחפש &quot;פיקדון&quot;, תראה בבת אחת
              את כל המקומות שמזכירים אותו, וכך אפשר לתפוס סתירה לפני שלקוח נתקל בה.
            </div>
          )}
          {current && (
            <>
              <div style={S.contentHead}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 17 }}>
                    {current.item.title}
                    {current.item.edited && <span style={S.editedTag}>נערך</span>}
                    {current.item.stale && <span style={S.staleTag}>מיושן</span>}
                  </div>
                  <div style={{ fontSize: 12, color: "#777", marginTop: 2 }}>
                    {current.layer.title} · {ORIGIN_LABEL[current.item.origin]} ·{" "}
                    {(draft ?? current.item.body).length.toLocaleString()} תווים
                    {current.item.tokens > 0 && ` · ~${Math.round((draft ?? current.item.body).length / 1.43).toLocaleString()} טוקנים`}
                    {snap.totalTokens > 0 && current.item.tokens > 0 &&
                      ` · ${((current.item.tokens / snap.totalTokens) * 100).toFixed(1)}% מהמוח`}
                  </div>
                </div>
                <span style={{ ...S.badge, background: current.item.editable ? "#e7f1ea" : "#f0eeea",
                                color: current.item.editable ? "#2c6e49" : "#777" }}>
                  {current.item.editable ? "ניתן לעריכה" : "נקבע בזמן אמת"}
                </span>
              </div>

              {current.item.matchNote && (
                <div style={S.matchNote}>
                  <b>הלקוח שואל:</b> {current.item.matchNote}
                  <div style={{ marginTop: 4, color: "#666" }}>
                    זה מה שנשלח ללקוח בפועל, בלי מודל ובלי עלות.
                    {(current.item.variantCount ?? 1) > 1 && (
                      <> הבוט <b>מגריל</b> בין כמה ניסוחים כדי שלקוח חוזר לא יקבל
                      את אותו משפט מילה במילה, ולכן מוצגות כאן כמה דוגמאות אמיתיות
                      מופרדות בשורת <code>~~~</code>.</>
                    )}
                  </div>
                </div>
              )}

              {current.item.editable && current.layer.key === "canned" && (
                <div style={S.howto}>
                  <b>איך עורכים:</b> כתוב את הניסוח שלך. רוצה שהבוט יגוון?
                  כתוב כמה ניסוחים, כל אחד מופרד בשורה שיש בה רק <code>~~~</code>,
                  והבוט יגריל ביניהם. מה שתשמור <b>יחליף לגמרי</b> את הניסוחים הקיימים.
                </div>
              )}

              {current.item.dynamic && !current.item.edited && (
                <div style={S.dynamicBox}>
                  <b>שים לב:</b> התבנית הזאת נבנית אוטומטית מהמידע העסקי (שעות, מחירים, כתובת).
                  אם תערוך אותה כאן היא תהפוך ל<b>טקסט קבוע</b> ולא תתעדכן יותר לבד -
                  למשל שינוי שעות במידע העסקי לא ישתקף בה. לשינויים בנתונים עצמם עדיף
                  לערוך ב&quot;מידע עסקי&quot;; כאן עורכים את <b>הניסוח</b>.
                </div>
              )}

              {current.item.dynamic && current.item.edited && (
                <div style={S.dynamicBox}>
                  התבנית הזאת <b>קבועה כרגע</b> כי נערכה ידנית, ולכן אינה מתעדכנת מהמידע העסקי.
                  &quot;חזרה לברירת מחדל&quot; תחזיר אותה להתעדכן לבד.
                </div>
              )}

              {current.item.stale && (
                <div style={S.staleBox}>
                  העריכה הזאת נשמרה על נוסח שכבר לא קיים בקוד, ולכן <b>היא לא מוחלת כרגע</b>.
                  לחץ &quot;חזרה לברירת מחדל&quot; ואז ערוך מחדש על הנוסח העדכני.
                </div>
              )}

              {!current.item.editable && <pre style={S.pre}>{current.item.body}</pre>}

              {current.item.editable && (
                <>
                  <textarea
                    value={draft ?? current.item.body}
                    onChange={(e) => setDraft(e.target.value)}
                    spellCheck={false}
                    style={S.editor}
                  />
                  <div style={S.editBar}>
                    <button
                      style={{ ...S.btn, opacity: saving || draft === null || draft === current.item.body ? 0.5 : 1 }}
                      disabled={saving || draft === null || draft === current.item.body}
                      onClick={() => void save(current.item, draft ?? "")}
                    >
                      {saving ? "שומר..." : "שמור והחל על הבוט"}
                    </button>
                    {draft !== null && draft !== current.item.body && (
                      <button style={S.btnGhost} onClick={() => setDraft(null)} disabled={saving}>
                        בטל שינוי
                      </button>
                    )}
                    {current.item.edited && (
                      <button
                        style={S.btnGhost}
                        disabled={saving}
                        onClick={() => { if (confirm("לחזור לנוסח המקורי שבקוד?")) void save(current.item, ""); }}
                      >
                        חזרה לברירת מחדל
                      </button>
                    )}
                    {saved && <span style={{ fontSize: 13, color: "#2c6e49" }}>{saved}</span>}
                  </div>

                  {current.item.edited && current.item.defaultText && (
                    <details style={S.details}>
                      <summary style={{ cursor: "pointer", fontSize: 13, color: "#555" }}>
                        הצג את הנוסח המקורי שבקוד
                      </summary>
                      <pre style={{ ...S.pre, color: "#666", marginTop: 8 }}>{current.item.defaultText}</pre>
                    </details>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>

      <div style={{ fontSize: 12, color: "#888", textAlign: "center" }}>
        עודכן {new Date(snap.generatedAt).toLocaleTimeString("he-IL")} · קריאה בלבד, שום דבר כאן לא משנה את הבוט
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  topbar: { display: "flex", gap: 22, alignItems: "center", background: "#fff", border: "1px solid #e3e6e0",
            borderRadius: 12, padding: "12px 16px", flexWrap: "wrap" },
  statBig: { fontSize: 20, fontWeight: 800, fontVariantNumeric: "tabular-nums" },
  statLabel: { fontSize: 11, color: "#777" },
  search: { padding: "7px 10px", border: "1px solid #d8d5cc", borderRadius: 8, minWidth: 220, fontSize: 14 },
  btn: { padding: "7px 14px", borderRadius: 8, border: "none", background: "#1f2937", color: "#fff", cursor: "pointer", fontSize: 14 },
  btnGhost: { padding: "7px 10px", borderRadius: 8, border: "1px solid #d8d5cc", background: "#fff", cursor: "pointer", fontSize: 14 },
  conflictBox: { background: "#fdf3f1", border: "1px solid #e8c4bd", borderRadius: 12, padding: "12px 16px" },
  conflict: { borderInlineStart: "4px solid #b3402e", paddingInlineStart: 10, margin: "8px 0" },
  card: { background: "#fff", border: "1px solid #e3e6e0", borderRadius: 12, padding: "12px 16px" },
  match: { padding: "8px 0", borderBottom: "1px solid #f0efeb", cursor: "pointer" },
  body: { display: "flex", gap: 12, alignItems: "flex-start", minHeight: 420 },
  nav: { width: 290, flexShrink: 0, background: "#fff", border: "1px solid #e3e6e0", borderRadius: 12,
         padding: 8, maxHeight: "72vh", overflowY: "auto" },
  layerBtn: { width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
              border: "none", padding: "8px 10px", borderRadius: 8, cursor: "pointer", fontSize: 14,
              fontWeight: 700, textAlign: "right" },
  layerNote: { fontSize: 11, color: "#888", padding: "2px 10px 6px" },
  count: { fontSize: 11, color: "#777", background: "#f2f1ed", borderRadius: 99, padding: "1px 7px" },
  itemBtn: { width: "100%", display: "flex", justifyContent: "space-between", gap: 6, alignItems: "center",
             border: "none", padding: "6px 10px", borderRadius: 7, cursor: "pointer", fontSize: 13, textAlign: "right" },
  itemTitle: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  tok: { fontSize: 10, color: "#999", fontVariantNumeric: "tabular-nums", flexShrink: 0 },
  content: { flex: 1, background: "#fff", border: "1px solid #e3e6e0", borderRadius: 12, padding: 16,
             maxHeight: "72vh", overflowY: "auto" },
  contentHead: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12,
                 borderBottom: "1px solid #eee", paddingBottom: 10, marginBottom: 10 },
  badge: { fontSize: 11, fontWeight: 700, borderRadius: 99, padding: "3px 10px", whiteSpace: "nowrap" },
  pre: { whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13.5, lineHeight: 1.75, margin: 0, color: "#222" },
  editor: { width: "100%", minHeight: 320, padding: 12, border: "1px solid #d8d5cc", borderRadius: 9,
            fontFamily: "inherit", fontSize: 13.5, lineHeight: 1.75, resize: "vertical", direction: "rtl" },
  editBar: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 10 },
  editedTag: { fontSize: 11, fontWeight: 700, background: "#e7f1ea", color: "#2c6e49",
               borderRadius: 99, padding: "2px 9px", marginInlineStart: 8, verticalAlign: "middle" },
  staleTag: { fontSize: 11, fontWeight: 700, background: "#f8e9e6", color: "#a6392b",
              borderRadius: 99, padding: "2px 9px", marginInlineStart: 6, verticalAlign: "middle" },
  staleBox: { background: "#f8e9e6", border: "1px solid #e8c4bd", borderRadius: 9,
              padding: "8px 12px", margin: "8px 0", fontSize: 13 },
  matchNote: { background: "#f2f1ed", borderRadius: 9, padding: "7px 12px", margin: "0 0 10px", fontSize: 13, color: "#444" },
  howto: { background: "#e8edf3", border: "1px solid #c5d3e3", borderRadius: 9,
           padding: "8px 12px", margin: "0 0 10px", fontSize: 13, lineHeight: 1.65 },
  dynamicBox: { background: "#fbf2df", border: "1px solid #e4cf9a", borderRadius: 9,
                padding: "8px 12px", margin: "0 0 10px", fontSize: 13, lineHeight: 1.65 },
  details: { marginTop: 12, borderTop: "1px solid #eee", paddingTop: 10 },
};
