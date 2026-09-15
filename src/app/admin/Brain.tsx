"use client";

/**
 * "מוח הבוט" - מסך שליטה ובקרה על כל מה שהבוט יודע. מנהל ראשי בלבד.
 *
 * שלב 0 (15.9): קריאה, חיפוש רוחבי, משקל בטוקנים, וגלאי סתירות. עריכה
 * תיפתח בשלב הבא, אחרי שנוודא שהמיפוי מדויק - כי הפרומפט הוא מה שמחזיק את
 * הבוט, ועריכה חופשית בלי שער היא גם היכולת לשבור אותו בלחיצה.
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
  const [openLayer, setOpenLayer] = useState<string>("rules");
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);

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

  const current = useMemo(() => {
    if (!snap || !selected) return null;
    for (const l of snap.layers) {
      const it = l.items.find((i) => i.id === selected);
      if (it) return { item: it, layer: l };
    }
    return null;
  }, [snap, selected]);

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
                  <div style={{ fontWeight: 800, fontSize: 17 }}>{current.item.title}</div>
                  <div style={{ fontSize: 12, color: "#777", marginTop: 2 }}>
                    {current.layer.title} · {ORIGIN_LABEL[current.item.origin]} ·{" "}
                    {current.item.chars.toLocaleString()} תווים
                    {current.item.tokens > 0 && ` · ${current.item.tokens.toLocaleString()} טוקנים`}
                    {snap.totalTokens > 0 && current.item.tokens > 0 &&
                      ` · ${((current.item.tokens / snap.totalTokens) * 100).toFixed(1)}% מהמוח`}
                  </div>
                </div>
                <span style={{ ...S.badge, background: current.item.editable ? "#e7f1ea" : "#f0eeea",
                                color: current.item.editable ? "#2c6e49" : "#777" }}>
                  {current.item.editable ? "ניתן לעריכה בפאנל" : "בקוד, עריכה בשלב הבא"}
                </span>
              </div>
              <pre style={S.pre}>{current.item.body}</pre>
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
};
