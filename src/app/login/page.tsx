"use client";

/**
 * מסך הכניסה של כל המערכת. כל האתר נעול (middleware) - זה הדף היחיד
 * שזר יכול לראות. כניסה מוצלחת מקבלת עוגיית התחברות חתומה (httpOnly)
 * מהשרת, שומרת את הטוקן ל-localStorage בשביל פאנל הניהול, וממשיכה
 * לאן שהמשתמש ניסה להגיע.
 */

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

const C = {
  bg: "#f8f5ef",
  panel: "#ffffff",
  panel2: "#f1ebe0",
  border: "#e2d9c8",
  text: "#241f19",
  muted: "#6d6355",
  accent: "#a3770f",
};

function safeNext(raw: string | null): string {
  // רק נתיב יחסי בתוך האתר - נגד open redirect
  if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/admin";
}

function LoginForm() {
  const params = useSearchParams();
  const [mode, setMode] = useState<"team" | "master">("team");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [master, setMaster] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    const body =
      mode === "team"
        ? { name: name.trim(), code: code.trim() }
        : { master: master.trim() };
    if (mode === "team" && (!name.trim() || !code.trim())) return;
    if (mode === "master" && !master.trim()) return;

    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "הכניסה נכשלה, נסו שוב");

      // הפאנל עובד עם הטוקן מ-localStorage (כמו תמיד); העוגייה כבר נקבעה בשרת
      if (mode === "team") {
        localStorage.setItem("admin_token", data.token);
        localStorage.setItem("agent_name", data.name || "");
      } else {
        localStorage.setItem("admin_token", master.trim());
      }
      window.location.replace(safeNext(params.get("next")));
    } catch (e) {
      setError(e instanceof Error ? e.message : "הכניסה נכשלה, נסו שוב");
      setBusy(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: C.panel2,
    border: `1px solid ${C.border}`,
    borderRadius: 12,
    padding: "11px 13px",
    fontSize: 16, // 16px ומעלה: מונע זום אוטומטי של אייפון בפוקוס
    color: C.text,
    outline: "none",
  };

  return (
    <main
      dir="rtl"
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        background: C.bg,
        color: C.text,
        padding: 16,
        fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
      }}
    >
      <div
        style={{
          background: C.panel,
          border: `1px solid ${C.border}`,
          borderRadius: 18,
          padding: 26,
          width: "100%",
          maxWidth: 360,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          boxShadow: "0 4px 24px rgba(36,31,25,.06)",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 6 }}>
          <div
            style={{
              width: 54,
              height: 54,
              margin: "0 auto 10px",
              borderRadius: "50%",
              background: C.accent,
              color: "#fff",
              display: "grid",
              placeItems: "center",
              fontSize: 26,
              fontWeight: 700,
            }}
          >
            ק
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: 1 }}>קפה קוואלי</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 3, letterSpacing: 2 }}>
            מערכת פנימית - כניסה למורשים בלבד
          </div>
        </div>

        {mode === "team" ? (
          <>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="שם משתמש"
              aria-label="שם משתמש"
              autoComplete="username"
              style={inputStyle}
            />
            <input
              type="password"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="סיסמה"
              aria-label="סיסמה"
              autoComplete="current-password"
              style={inputStyle}
            />
          </>
        ) : (
          <input
            type="password"
            value={master}
            onChange={(e) => setMaster(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="קוד גישה ראשי"
            aria-label="קוד גישה ראשי"
            autoComplete="off"
            style={inputStyle}
          />
        )}

        {error && (
          <div style={{ fontSize: 13, color: "#b3261e", textAlign: "center" }}>{error}</div>
        )}

        <button
          onClick={submit}
          disabled={busy}
          style={{
            width: "100%",
            background: C.accent,
            color: "#fff",
            fontWeight: 600,
            border: "none",
            borderRadius: 12,
            padding: "12px 0",
            fontSize: 16,
            cursor: "pointer",
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? "נכנס…" : "כניסה"}
        </button>

        <button
          onClick={() => {
            setMode(mode === "team" ? "master" : "team");
            setError("");
          }}
          style={{
            background: "none",
            border: "none",
            color: C.muted,
            fontSize: 12,
            cursor: "pointer",
            padding: 4,
          }}
        >
          {mode === "team" ? "כניסת מנהל עם קוד גישה ראשי" : "→ חזרה לכניסה עם שם משתמש"}
        </button>
      </div>
    </main>
  );
}

export default function LoginPage() {
  // useSearchParams דורש Suspense בזמן בנייה סטטית
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
