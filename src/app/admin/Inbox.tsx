"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  CHANNELS,
  relTime,
  waitLabel,
  waitSeverity,
  type ConvItem,
  type CustomerEnrichment,
  type Detail,
  type QuickReply,
} from "./types";
import { parseMemory } from "@/lib/customer-memory-format";

/* ============================== עזרים ============================== */

function initials(name?: string, fallback = "?"): string {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
}

/** "מאז יוני 2026" (חודש בלבד אם אותה שנה) - לשורת העובדות בכרטיס הלקוח. */
function sinceLabel(ts: number): string {
  const now = new Date();
  const d = new Date(ts);
  const sameYear = d.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat("he-IL", {
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(d);
}

/** שפת הלקוח לפי הודעותיו האחרונות (להצגת צ'יפ "אנגלית" כשמדובר בתייר). */
function detectCustomerLang(messages: { role: string; content: string }[]): "he" | "en" {
  const text = messages
    .filter((m) => m.role === "user")
    .slice(-6)
    .map((m) => m.content)
    .join(" ");
  const hebrew = (text.match(/[֐-׿]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  return hebrew === 0 && latin >= 4 ? "en" : "he";
}

/** תצוגת טלפון ישראלי נעימה: 972542142547 -> 054-2142547. */
function formatPhone(p: string): string {
  let d = p.replace(/\D/g, "");
  if (d.startsWith("972")) d = "0" + d.slice(3);
  if (d.length === 10 && d.startsWith("0")) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return d || p;
}

/** קישור חיוג לטלפון (פותח את המחייג בטלפון). */
function telHref(p: string): string {
  let d = p.replace(/\D/g, "");
  if (d.startsWith("0")) d = "972" + d.slice(1);
  return `tel:+${d}`;
}

function Avatar({ name, channel, size = 38 }: { name?: string; channel: string; size?: number }) {
  const dot = CHANNELS[channel]?.dot ?? "bg-neutral-500";
  return (
    <div
      className={`shrink-0 rounded-full ${dot} grid place-items-center text-white font-semibold`}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials(name) || "🙂"}
    </div>
  );
}

const SEV_CLS: Record<string, string> = {
  ok: "text-[var(--muted)]",
  warn: "text-amber-400",
  urgent: "text-red-400 font-semibold",
};

/** קישורים לחיצים ובטוחים בתוך הודעה: http/https בלבד, בלי לרנדר HTML */
function renderContent(text: string) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((p, i) =>
    /^https?:\/\//.test(p) ? (
      <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="underline break-all">
        {p}
      </a>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}

/** תווית יום להפרדה בין הודעות */
function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, today)) return "היום";
  if (same(d, yesterday)) return "אתמול";
  return d.toLocaleDateString("he-IL", { day: "numeric", month: "long" });
}

/** state שנשמר ב-storage (מסננים ב-session, טיוטות ו"נקרא" ב-local) */
function readStorage(store: "session" | "local", key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  try {
    const s = store === "session" ? sessionStorage : localStorage;
    return s.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function writeStorage(store: "session" | "local", key: string, value: string) {
  try {
    const s = store === "session" ? sessionStorage : localStorage;
    s.setItem(key, value);
  } catch {
    /* private mode */
  }
}

type Filter = "all" | "awaiting" | "escalated" | "human" | "closed";
export interface InboxFilterIntent {
  status?: Filter;
  /** פתיחה ישירה של שיחה ספציפית (קפיצה מ"ידע"/"הזמנות") */
  conversationId?: string;
}

const READ_KEY = "inbox_read_v1";
function loadReadMap(): Record<string, number> {
  try {
    return JSON.parse(readStorage("local", READ_KEY, "{}"));
  } catch {
    return {};
  }
}

/**
 * שורת שיחה ברשימה - קומפוננטה ממוזכרת נפרדת (ביצועים במובייל):
 * לחיצה על שיחה או עדכון מהסקר מרנדרים מחדש רק את השורות שהשתנו בפועל,
 * במקום לבנות מחדש את כל הרשימה - זה מה שגרם ללחיצה להרגיש תקועה בטלפון.
 * tick מתחלף פעם בדקה רק כדי לרענן את תוויות הזמן היחסי.
 */
const ConvRow = memo(function ConvRow({
  c,
  readTs,
  selected,
  tick,
  onOpen,
}: {
  c: ConvItem;
  readTs: number;
  selected: boolean;
  tick: number;
  onOpen: (id: string) => void;
}) {
  void tick;
  // "ממתין": הלקוח כתב אחרון, או שיחה אצל נציג שאף נציג עוד לא ענה בה
  // (גם כשההודעה האחרונה היא הודעת ההעברה של הבוט)
  const needsReply = c.awaiting || (c.status === "human" && c.lastRole !== "agent");
  const sev = needsReply && c.status !== "closed" ? waitSeverity(c.lastUserTs) : "none";
  const unread = c.updatedAt > readTs;
  return (
    <button
      onClick={() => onOpen(c.id)}
      className={`conv-row w-full text-right p-3 border-b border-[var(--border)] hover:bg-[var(--panel2)] flex gap-2.5 ${selected ? "bg-[var(--panel2)]" : ""}`}
    >
      <div className="relative shrink-0">
        <Avatar name={c.customerName} channel={c.channel} />
        {unread && (
          <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[var(--accent)] border-2 border-[var(--panel)]" title="יש חדש" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className={`text-sm truncate flex items-center gap-1 ${unread ? "font-bold" : "font-semibold"}`}>
            {c.vip && <span title="VIP">⭐</span>}
            {c.customerName || "לקוח"}
          </span>
          <span className="text-[10px] text-[var(--muted)] shrink-0">{relTime(c.updatedAt)}</span>
        </div>
        <div className={`text-xs truncate mt-0.5 ${unread ? "text-[var(--text)]" : "text-[var(--muted)]"}`} dir="auto">
          {c.lastMessage || "(אין הודעות)"}
        </div>
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          <span className={`text-[10px] px-1.5 py-0.5 rounded-md ${CHANNELS[c.channel]?.chip}`}>
            {CHANNELS[c.channel]?.label}
          </span>
          {c.status === "closed" && <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-neutral-500/15 text-neutral-400">סגורה</span>}
          {c.urgent && <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-red-500/20 text-red-300 font-semibold">🔴 דחוף</span>}
          {c.escalated && <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-300">הסלמה</span>}
          {c.status === "human" && <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-sky-500/15 text-sky-300">נציג מטפל</span>}
          {c.botPaused && c.status !== "human" && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-purple-500/15 text-purple-300">בוט מושהה</span>
          )}
          {sev !== "none" && (
            <span className={`text-[10px] ${SEV_CLS[sev]}`}>● ממתין {waitLabel(c.lastUserTs)}</span>
          )}
        </div>
      </div>
    </button>
  );
});

/* ============================== רכיב ראשי ============================== */

export default function Inbox({
  token,
  agentName,
  conversations,
  loaded,
  selectedId,
  setSelectedId,
  onMutate,
  templates,
  intent,
  onIntentConsumed,
}: {
  token: string;
  agentName: string;
  conversations: ConvItem[];
  loaded: boolean;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  onMutate: () => void;
  templates: QuickReply[];
  intent: InboxFilterIntent | null;
  onIntentConsumed: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  // מסננים וחיפוש שורדים מעבר בין מסכים (session) - כך שחזרה מהדשבורד לא מאפסת.
  // נטענים ב-effect (ולא באתחול ה-state) כדי לא ליצור hydration mismatch מול ה-SSR.
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<Filter>("all");
  const storageHydrated = useRef(false);
  useEffect(() => {
    setSearch(readStorage("session", "inbox_q", ""));
    setChannelFilter(readStorage("session", "inbox_ch", "all"));
    // סינוני "ממתינות"/"הסלמות" אוחדו לתוך "אצל נציג" - ערכים ישנים ממופים אליו
    const st = (readStorage("session", "inbox_st", "all") as Filter) || "all";
    setStatusFilter(st === "awaiting" || st === "escalated" ? "human" : st);
    storageHydrated.current = true;
  }, []);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false); // מניעת שליחה כפולה גם בלחיצות מהירות
  const [suggesting, setSuggesting] = useState(false);
  const [err, setErr] = useState("");
  const [sendFailed, setSendFailed] = useState(false);
  const [showCard, setShowCard] = useState(false);
  const [readMap, setReadMap] = useState<Record<string, number>>(loadReadMap);
  const [newBelow, setNewBelow] = useState(false);
  // "פעימת דקה" לרענון תוויות זמן יחסי בתוך הרשימה הממוזכרת (relTime/waitLabel)
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNowTick((x) => x + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listScrollPos = useRef(0);
  const nearBottom = useRef(true);
  const prevMsgCount = useRef(0);
  const prevConvId = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (storageHydrated.current) writeStorage("session", "inbox_q", search);
  }, [search]);
  useEffect(() => {
    if (storageHydrated.current) writeStorage("session", "inbox_ch", channelFilter);
  }, [channelFilter]);
  useEffect(() => {
    if (storageHydrated.current) writeStorage("session", "inbox_st", statusFilter);
  }, [statusFilter]);

  // כוונת סינון שמגיעה מהדשבורד ("ממתינות למענה" וכו')
  useEffect(() => {
    if (!intent) return;
    // כוונות מהדשבורד עם הסינונים הישנים (ממתינות/הסלמות) ממופות לדלי המאוחד
    if (intent.status)
      setStatusFilter(intent.status === "awaiting" || intent.status === "escalated" ? "human" : intent.status);
    // קפיצה לשיחה ספציפית: מנקים סינונים כדי שהשיחה תופיע ברשימה
    if (intent.conversationId) {
      setStatusFilter("all");
      setChannelFilter("all");
      setSearch("");
      setSelectedId(intent.conversationId);
    } else {
      setSelectedId(null);
    }
    onIntentConsumed();
  }, [intent, onIntentConsumed, setSelectedId]);

  const markRead = useCallback((id: string) => {
    setReadMap((prev) => {
      const next = { ...prev, [id]: Date.now() };
      writeStorage("local", READ_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const lastDetailJson = useRef("");
  // ביצועים: השרת שולח רק את ~120 ההודעות האחרונות. "הצג הודעות קודמות" טוען
  // את כל ההיסטוריה - והדגל נשמר כדי שהסקר של כל 4 שניות לא יקטום אותה בחזרה.
  const wantAllHistory = useRef(false);
  // גובה הגלילה לפני הוספת היסטוריה מעל - כדי להישאר על אותה הודעה אחרי הטעינה
  const prependAdjust = useRef<number | null>(null);
  const loadDetail = useCallback(
    async (id: string) => {
      try {
        const d = await api<Detail>(token, `/conversations/${id}${wantAllHistory.current ? "?all=1" : ""}`);
        // ביצועים: הריענון של כל 4 שניות מרנדר מחדש את כל השיחה גם כשכלום לא
        // השתנה - במובייל זה גורם להקלדה מקוטעת. מדלגים כשאין שינוי אמיתי.
        const json = JSON.stringify(d);
        if (json !== lastDetailJson.current) {
          lastDetailJson.current = json;
          setDetail(d);
        }
      } catch {
        /* ignore - הבאנר הגלובלי מטפל בניתוק */
      }
    },
    [token]
  );

  // טעינת פרטי השיחה הנבחרת + ריענון חי כל 4 שניות
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    // מעבר לשיחה אחרת: מנקים את הקודמת מיד (שלא תוצג שנייה של שיחה לא נכונה)
    // ומאפסים את מטמון הדילוג - אחרת חזרה לאותה שיחה עלולה להיתקע על השלד.
    setDetail((d) => (d && d.conversation.id !== selectedId ? null : d));
    lastDetailJson.current = "";
    wantAllHistory.current = false; // כל שיחה נפתחת עם ההודעות האחרונות בלבד (מהיר)
    loadDetail(selectedId);
    const t = setInterval(() => {
      // ברקע לא סוקרים - onWake של הפאנל מרענן הכל מיד עם החזרה
      if (document.visibilityState === "visible") loadDetail(selectedId);
    }, 4000);
    return () => clearInterval(t);
  }, [selectedId, loadDetail]);

  // טיוטה פר-שיחה: נטענת בכניסה, נשמרת בכל הקלדה, שורדת רענון ומעבר בין שיחות
  useEffect(() => {
    if (!selectedId) return;
    setReply(readStorage("local", `draft_${selectedId}`, ""));
    setErr("");
    setSendFailed(false);
    setShowCard(false);
  }, [selectedId]);

  function updateReply(v: string) {
    setReply(v);
    if (selectedId) writeStorage("local", `draft_${selectedId}`, v);
    autoGrow();
  }
  function autoGrow() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 128) + "px";
  }
  // התאמת גובה גם כשטיוטה נטענת מהאחסון (ולא רק בהקלדה)
  useEffect(() => {
    autoGrow();
  }, [reply]);

  // גלילה חכמה: לתחתית רק בפתיחת שיחה או כשהמשתמש כבר קרוב לתחתית.
  // כשקוראים הודעות ישנות למעלה - לא קופצים, אלא מציגים צ'יפ "הודעות חדשות".
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !detail) return;
    // אחרי טעינת "הודעות קודמות": ההיסטוריה נוספה מעל - מחזירים את הגלילה
    // לאותה הודעה שהמשתמש הסתכל עליה, בלי קפיצה לתחתית ובלי צ'יפ "חדשות".
    if (prependAdjust.current !== null) {
      el.scrollTop += el.scrollHeight - prependAdjust.current;
      prependAdjust.current = null;
      prevConvId.current = detail.conversation.id;
      prevMsgCount.current = detail.messages.length;
      return;
    }
    const opened = prevConvId.current !== detail.conversation.id;
    const grew = detail.messages.length > prevMsgCount.current;
    prevConvId.current = detail.conversation.id;
    prevMsgCount.current = detail.messages.length;
    if (opened || nearBottom.current) {
      el.scrollTop = el.scrollHeight;
      setNewBelow(false);
    } else if (grew) {
      setNewBelow(true);
    }
  }, [detail]);

  // שיחה פתוחה = נקראת (גם כשמגיעות הודעות חדשות תוך כדי צפייה)
  useEffect(() => {
    if (selectedId && detail?.conversation.id === selectedId) markRead(selectedId);
  }, [selectedId, detail, markRead]);

  const openConversation = useCallback(
    (id: string) => {
      listScrollPos.current = listRef.current?.scrollTop ?? 0;
      setSelectedId(id);
    },
    [setSelectedId]
  );

  // שליחה יזומה של הוראות חניה (לקוח שהתקשר וביקש מהמארחת "שלחי לי בוואטסאפ")
  const [parkingOpen, setParkingOpen] = useState(false);
  const [parkingPhone, setParkingPhone] = useState("");
  const [parkingBusy, setParkingBusy] = useState(false);
  const [parkingMsg, setParkingMsg] = useState("");
  async function sendParking() {
    if (!parkingPhone.trim() || parkingBusy) return;
    setParkingBusy(true);
    setParkingMsg("");
    try {
      await api(token, "/send-parking", {
        method: "POST",
        body: JSON.stringify({ phone: parkingPhone, agentName }),
      });
      setParkingMsg("✅ נשלח! ההודעה בדרך ללקוח");
      setParkingPhone("");
      onMutate();
      setTimeout(() => {
        setParkingMsg("");
        setParkingOpen(false);
      }, 4000);
    } catch (e) {
      setParkingMsg(`⚠ ${e instanceof Error ? e.message : "השליחה נכשלה"}`);
    } finally {
      setParkingBusy(false);
    }
  }
  function backToList() {
    setSelectedId(null);
  }
  // חזרה משיחה מחזירה לאותו מיקום ברשימה (במובייל הרשימה הוסתרה בינתיים)
  useEffect(() => {
    if (!selectedId && listRef.current) listRef.current.scrollTop = listScrollPos.current;
  }, [selectedId]);

  const counts = useMemo(() => {
    const open = conversations.filter((c) => c.status !== "closed");
    return {
      awaiting: open.filter((c) => c.awaiting).length,
      escalated: open.filter((c) => c.escalated).length,
      // "אצל נציג" = הדלי המאוחד של כל מה שדורש בן אדם: נלקחה ע"י נציג,
      // הוסלמה, או שהלקוח כתב ואף אחד לא ענה
      human: open.filter((c) => c.status === "human" || c.escalated || c.awaiting).length,
    };
  }, [conversations]);

  // בר התראה לשיחות אצל נציג שעוד לא נענו: נספרת גם שיחה שההודעה האחרונה בה
  // היא הודעת ההעברה של הבוט ("נציג יחזור אליך") ואף נציג עוד לא כתב - הלקוח
  // הובטח לו מענה אנושי והוא ממתין. ✕ מעלים את הבר, והוא חוזר אוטומטית רק
  // כשמגיעה הודעת לקוח חדשה יותר מרגע ההעלמה (טיפול מתמשך לא מציק).
  const humanAwaiting = useMemo(
    () => conversations.filter((c) => c.status === "human" && c.lastRole !== "agent"),
    [conversations]
  );
  const [humanBarDismissedAt, setHumanBarDismissedAt] = useState(Number.MAX_SAFE_INTEGER);
  useEffect(() => {
    setHumanBarDismissedAt(Number(readStorage("session", "human_bar_dismissed", "0")) || 0);
  }, []);
  const newestHumanWait = humanAwaiting.reduce((m, c) => Math.max(m, c.lastUserTs ?? c.updatedAt), 0);
  const showHumanBar = humanAwaiting.length > 0 && newestHumanWait > humanBarDismissedAt;
  function dismissHumanBar() {
    setHumanBarDismissedAt(newestHumanWait);
    writeStorage("session", "human_bar_dismissed", String(newestHumanWait));
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations.filter((c) => {
      if (statusFilter === "closed") {
        if (c.status !== "closed") return false;
      } else {
        // "הכל" = שיחות שאינן סגורות; לסגורות יש מסנן ייעודי
        if (c.status === "closed") return false;
        if (statusFilter === "awaiting" && !c.awaiting) return false;
        if (statusFilter === "escalated" && !c.escalated) return false;
        // "אצל נציג" (הדלי המאוחד): אצל נציג / הוסלמה / ממתינה למענה
        if (statusFilter === "human" && !(c.status === "human" || c.escalated || c.awaiting)) return false;
      }
      if (channelFilter !== "all" && c.channel !== channelFilter) return false;
      if (q) {
        const hay = `${c.customerName ?? ""} ${c.lastMessage ?? ""} ${c.customerId} ${(c.tags ?? []).join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [conversations, search, channelFilter, statusFilter]);

  // ביצועים (מובייל): מרנדרים רק את 60 השיחות הראשונות + כפתור "הצג עוד".
  // סינון/חיפוש חדשים מתחילים שוב מ-60 - הרינדור נשאר קטן ומהיר.
  const [listLimit, setListLimit] = useState(60);
  useEffect(() => {
    setListLimit(60);
  }, [search, channelFilter, statusFilter]);
  const visibleRows = useMemo(() => filtered.slice(0, listLimit), [filtered, listLimit]);

  // ביצועים (מובייל): גם בועות ההודעות ממוזכרות - תלויות רק בתוכן השיחה,
  // כך שהקלדה בתיבת המענה לא מרנדרת מחדש את כל ההיסטוריה בכל תו.
  const messageRows = useMemo(
    () =>
      detail?.messages.map((m, i) => {
        const prev = detail.messages[i - 1];
        const daySep = !prev || dayLabel(prev.ts) !== dayLabel(m.ts) ? (
          <div key={`day-${m.id}`} className="text-center py-1">
            <span className="text-[10px] text-[var(--muted)] bg-[var(--panel2)] rounded-full px-3 py-1">{dayLabel(m.ts)}</span>
          </div>
        ) : null;

        if (m.role === "system") {
          if (!m.meta?.activity) return daySep;
          return (
            <div key={m.id} className="msg-row">
              {daySep}
              <div className="text-center">
                <span className="text-[10px] text-[var(--muted)] bg-[var(--panel2)] rounded-full px-2.5 py-0.5">
                  {m.content} · {new Date(m.ts).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            </div>
          );
        }
        const mine = m.role !== "user";
        return (
          <div key={m.id} className="msg-row">
            {daySep}
            <div className={`flex ${mine ? "justify-start" : "justify-end"}`}>
              <div className="max-w-[85%] md:max-w-[70%]">
                <div
                  dir="auto"
                  className={`rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words leading-relaxed ${
                    m.role === "user"
                      ? "bg-[var(--panel2)] text-[var(--text)]"
                      : m.role === "agent"
                      ? "bg-amber-600 text-white"
                      : "bg-[var(--accent)] text-[var(--accent-fg)]"
                  }`}
                >
                  {renderContent(m.content)}
                </div>
                {m.media?.map((md, j) =>
                  md.type === "video" ? (
                    <video
                      key={j}
                      src={md.url}
                      controls
                      preload="metadata"
                      playsInline
                      title={md.label}
                      className="rounded-xl max-w-full max-h-64 mt-1 bg-black/30"
                    />
                  ) : (
                    <a key={j} href={md.url} target="_blank" rel="noreferrer" title={md.label}>
                      <img src={md.url} alt={md.label || "תמונה"} loading="lazy" className="rounded-xl max-w-full max-h-64 mt-1" />
                    </a>
                  )
                )}
                <div className={`text-[10px] text-[var(--muted)] mt-0.5 ${mine ? "text-left" : "text-right"}`}>
                  {m.role === "agent"
                    ? `נציג${m.meta?.agentName ? ` · ${String(m.meta?.agentName)}` : ""} ✓`
                    : m.role === "assistant"
                    ? "בוט"
                    : ""}{" "}
                  {new Date(m.ts).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
            </div>
          </div>
        );
      }),
    [detail]
  );

  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (!selectedId) return;
    setBusy(true);
    setErr("");
    try {
      await api(token, `/conversations/${selectedId}/action`, {
        method: "POST",
        body: JSON.stringify({ action, agentName, ...extra }),
      });
      await loadDetail(selectedId);
      onMutate();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "שגיאה");
    } finally {
      setBusy(false);
    }
  }

  async function sendReply() {
    const text = reply.trim();
    if (!text || !detail || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setErr("");
    setSendFailed(false);
    try {
      // מענה ידני משתיק את הבוט בשיחה הזו כדי שלא יענה גם הוא
      if (detail.conversation.status !== "human" && !detail.conversation.botPaused) {
        await api(token, `/conversations/${detail.conversation.id}/action`, {
          method: "POST",
          body: JSON.stringify({ action: "pauseBot" }),
        });
      }
      await api(token, `/conversations/${detail.conversation.id}/action`, {
        method: "POST",
        body: JSON.stringify({ action: "reply", text, agentName }),
      });
      // רק אחרי שהשרת אישר: מנקים את הטיוטה
      setReply("");
      if (selectedId) writeStorage("local", `draft_${selectedId}`, "");
      nearBottom.current = true;
      await loadDetail(detail.conversation.id);
      onMutate();
    } catch (e) {
      // הטיוטה נשארת בשדה - שום דבר לא הולך לאיבוד
      setErr(e instanceof Error ? e.message : "שליחה נכשלה");
      setSendFailed(true);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  /** ליטוש ניסוח: לוקח את מה שהנציג כתב ומסגנן מקצועי - לא ממציא תשובה */
  async function polishText() {
    const text = reply.trim();
    if (!detail || !text) return;
    setSuggesting(true);
    setErr("");
    try {
      const r = await api<{ suggestion: string }>(token, `/conversations/${detail.conversation.id}/suggest`, {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      if (r.suggestion) updateReply(r.suggestion);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "שגיאה");
    } finally {
      setSuggesting(false);
    }
  }

  const conv = detail?.conversation;
  const closed = conv?.status === "closed";
  const botState = conv?.status === "human" ? "human" : conv?.botPaused ? "paused" : "active";

  /* ============================== רינדור ============================== */

  return (
    <div className="grid grid-cols-1 md:grid-cols-[340px_minmax(0,1fr)] md:gap-4 h-full">
      {/* ===== רשימת שיחות ===== */}
      <aside
        className={`${selectedId ? "hidden md:flex" : "flex"} flex-col bg-[var(--panel)] md:border border-[var(--border)] md:rounded-2xl overflow-hidden min-h-0`}
      >
        {/* בר התראה: לקוח כתב בשיחה שנציג לקח - הבוט שותק שם, ואם אף אחד לא שם לב
            הלקוח נשאר בלי מענה. ✕ מעלים עד שתגיע הודעה חדשה יותר (טיפול מתמשך). */}
        {showHumanBar && (
          <div className="await-pulse shrink-0 m-2 mb-0 flex items-center gap-2 bg-orange-500/15 border border-orange-500/40 rounded-xl px-3 py-2 text-xs">
            <span className="flex-1 font-semibold">
              👤 {humanAwaiting.length === 1 ? "שיחה אחת אצל נציג ממתינה לתשובה" : `${humanAwaiting.length} שיחות אצל נציג ממתינות לתשובה`}
            </span>
            <button
              onClick={() => {
                setStatusFilter("human");
                setSelectedId(null);
              }}
              className="shrink-0 font-bold text-[var(--accent)] underline"
            >
              הצג
            </button>
            <button onClick={dismissHumanBar} aria-label="הסתר את ההתראה" className="shrink-0 w-6 h-6 grid place-items-center rounded-md text-[var(--muted)] hover:text-[var(--text)]">
              ✕
            </button>
          </div>
        )}
        <div className="p-3 border-b border-[var(--border)] space-y-2 shrink-0">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש לפי שם, טקסט, תגית…"
            aria-label="חיפוש שיחות"
            className="w-full bg-[var(--panel2)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />
          {/* סינון אחד לכל מה שדורש בן אדם ("אצל נציג") - הסלמה/המתנה מוצגות
              כתוויות על השורה עצמה, לא כסינונים נפרדים (איחוד לבקשת המשתמש 10.8) */}
          <div className="flex gap-1 flex-wrap text-xs" role="tablist" aria-label="סינון לפי מצב">
            {(
              [
                ["all", "הכל"],
                ["human", counts.human ? `אצל נציג · ${counts.human}` : "אצל נציג"],
                ["closed", "סגורות"],
              ] as [Filter, string][]
            ).map(([k, l]) => (
              <button
                key={k}
                onClick={() => setStatusFilter(k)}
                aria-pressed={statusFilter === k}
                className={`rounded-lg px-2.5 py-1.5 transition ${statusFilter === k ? "bg-[var(--accent)] text-[var(--accent-fg)] font-semibold" : "bg-[var(--panel2)] text-[var(--muted)] hover:text-[var(--text)]"}`}
              >
                {l}
              </button>
            ))}
            <button
              onClick={() => setParkingOpen((o) => !o)}
              aria-expanded={parkingOpen}
              title="שליחת הוראות הגעה וחניה בוואטסאפ ללקוח שהתקשר"
              className={`rounded-lg px-2.5 py-1.5 mr-auto ${parkingOpen ? "bg-[var(--accent)] text-[var(--accent-fg)] font-semibold" : "bg-[var(--panel2)] text-[var(--muted)] hover:text-[var(--text)]"}`}
            >
              📍 שלח חניה
            </button>
          </div>
          {parkingOpen && (
            <div className="space-y-1.5">
              <div className="flex gap-2">
                <input
                  value={parkingPhone}
                  onChange={(e) => setParkingPhone(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") sendParking();
                  }}
                  placeholder="מספר הלקוח, למשל 0501234567"
                  dir="ltr"
                  inputMode="tel"
                  className="flex-1 bg-[var(--panel2)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                />
                <button
                  onClick={sendParking}
                  disabled={parkingBusy || !parkingPhone.trim()}
                  className="bg-[var(--accent)] text-[var(--accent-fg)] text-sm font-semibold rounded-xl px-4 disabled:opacity-40"
                >
                  {parkingBusy ? "שולח…" : "שלח"}
                </button>
              </div>
              {parkingMsg && <div className="text-[11px]">{parkingMsg}</div>}
              <div className="text-[10px] text-[var(--muted)]">
                הלקוח יקבל בוואטסאפ את הכתובת, ניווט ב-Waze וסרטון הדרך לחניה - והשיחה תתועד כאן בפאנל.
              </div>
            </div>
          )}
          <div className="flex gap-1 flex-wrap text-xs">
            <button
              onClick={() => setChannelFilter("all")}
              className={`rounded-lg px-2 py-1 ${channelFilter === "all" ? "bg-[var(--panel2)] text-[var(--text)]" : "text-[var(--muted)]"}`}
            >
              כל הערוצים
            </button>
            {Object.entries(CHANNELS).map(([k, v]) => (
              <button
                key={k}
                onClick={() => setChannelFilter(k)}
                className={`rounded-lg px-2 py-1 flex items-center gap-1 ${channelFilter === k ? "bg-[var(--panel2)] text-[var(--text)]" : "text-[var(--muted)]"}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${v.dot}`} />
                {v.label}
              </button>
            ))}
          </div>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto overscroll-contain">
          {!loaded && (
            <div className="p-3 space-y-3" aria-label="טוען שיחות">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex gap-2.5 animate-pulse">
                  <div className="w-10 h-10 rounded-full bg-[var(--panel2)]" />
                  <div className="flex-1 space-y-2 py-1">
                    <div className="h-3 bg-[var(--panel2)] rounded w-1/2" />
                    <div className="h-2.5 bg-[var(--panel2)] rounded w-3/4" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {loaded && filtered.length === 0 && (
            <div className="text-sm text-[var(--muted)] p-8 text-center">
              {conversations.length === 0 ? "עדיין אין שיחות. ברגע שלקוח יכתוב - זה יופיע כאן." : "אין שיחות בסינון הזה"}
            </div>
          )}
          {loaded &&
            visibleRows.map((c) => (
              <ConvRow
                key={c.id}
                c={c}
                readTs={readMap[c.id] ?? 0}
                selected={selectedId === c.id}
                tick={nowTick}
                onOpen={openConversation}
              />
            ))}
          {loaded && filtered.length > listLimit && (
            <button
              onClick={() => setListLimit((n) => n + 120)}
              className="w-full py-3 text-xs text-[var(--muted)] hover:text-[var(--text)] text-center"
            >
              הצג עוד שיחות ({filtered.length - listLimit})
            </button>
          )}
        </div>
      </aside>

      {/* ===== שיחה ===== */}
      <section
        className={`${selectedId ? "flex" : "hidden md:flex"} flex-col bg-[var(--panel)] md:border border-[var(--border)] md:rounded-2xl overflow-hidden min-h-0`}
      >
        {!conv && !selectedId && (
          <div className="flex-1 grid place-items-center text-[var(--muted)] text-sm p-8 text-center">
            בחר שיחה מהרשימה כדי לצפות, להגיב ולנהל
          </div>
        )}
        {!conv &&
          selectedId &&
          (() => {
            // מסך השיחה נפתח מיידית עם מה שכבר ידוע מהרשימה (שם, ערוץ) ושלד הודעות -
            // כך הלחיצה מרגישה מיידית גם כשההודעות עוד בדרך מהשרת (חשוב במובייל).
            const p = conversations.find((c) => c.id === selectedId);
            return (
              <>
                <header className="pt-[env(safe-area-inset-top)] border-b border-[var(--border)] shrink-0">
                  <div className="p-2 md:p-3 flex items-center gap-2">
                    <button
                      onClick={backToList}
                      className="md:hidden shrink-0 w-11 h-11 grid place-items-center rounded-xl text-[var(--text)] hover:bg-[var(--panel2)] text-xl"
                      aria-label="חזרה לרשימת השיחות"
                    >
                      →
                    </button>
                    <Avatar name={p?.customerName} channel={p?.channel ?? ""} size={34} />
                    <div className="min-w-0">
                      <div className="font-bold text-sm truncate">{p?.customerName || "לקוח"}</div>
                      <div className="text-[10px] text-[var(--muted)]">טוען את השיחה…</div>
                    </div>
                  </div>
                </header>
                <div className="flex-1 p-3 space-y-3 animate-pulse" aria-label="טוען שיחה">
                  <div className="h-12 w-3/5 bg-[var(--panel2)] rounded-2xl ml-auto" />
                  <div className="h-16 w-3/4 bg-[var(--panel2)] rounded-2xl" />
                  <div className="h-10 w-2/5 bg-[var(--panel2)] rounded-2xl ml-auto" />
                  <div className="h-12 w-2/3 bg-[var(--panel2)] rounded-2xl" />
                </div>
              </>
            );
          })()}
        {conv && (
          <>
            {/* כותרת - קומפקטית, עם חזרה ברורה במובייל */}
            <header className="pt-[env(safe-area-inset-top)] border-b border-[var(--border)] shrink-0">
              <div className="p-2 md:p-3 flex items-center gap-1.5">
                <button
                  onClick={backToList}
                  className="md:hidden shrink-0 w-11 h-11 grid place-items-center rounded-xl text-[var(--text)] hover:bg-[var(--panel2)] text-xl"
                  aria-label="חזרה לרשימת השיחות"
                >
                  →
                </button>
                <button onClick={() => setShowCard((s) => !s)} className="flex items-center gap-2 min-w-0 flex-1 text-right" aria-expanded={showCard} aria-label="פרטי הלקוח">
                  <Avatar name={detail?.customer?.name} channel={conv.channel} size={34} />
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate flex items-center gap-1">
                      {detail?.customer?.vip && <span>⭐</span>}
                      {detail?.customer?.name || "לקוח"}
                    </div>
                    <div className="text-[11px] text-[var(--muted)] flex items-center gap-1.5">
                      <span className={`px-1.5 rounded ${CHANNELS[conv.channel]?.chip}`}>{CHANNELS[conv.channel]?.label}</span>
                      <span className={closed ? "text-neutral-400" : botState === "human" ? "text-sky-300" : botState === "paused" ? "text-purple-300" : "text-emerald-400"}>
                        {closed ? "שיחה סגורה" : botState === "human" ? "נציג מטפל" : botState === "paused" ? "בוט מושהה" : "בוט עונה"}
                      </span>
                    </div>
                  </div>
                </button>
                <div className="flex gap-1.5 shrink-0">
                  {!closed && botState === "active" && (
                    <button onClick={() => act("pauseBot")} disabled={busy} className="text-xs bg-purple-600/90 hover:bg-purple-600 text-white rounded-lg px-2.5 py-2 min-h-9">
                      השהה בוט
                    </button>
                  )}
                  {!closed && botState === "paused" && (
                    <button onClick={() => act("resumeBot")} disabled={busy} className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg px-2.5 py-2 min-h-9">
                      הפעל בוט
                    </button>
                  )}
                  {!closed && botState === "human" && (
                    <button onClick={() => act("release")} disabled={busy} className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg px-2.5 py-2 min-h-9">
                      החזר לבוט
                    </button>
                  )}
                  {!closed ? (
                    <button onClick={() => act("close")} disabled={busy} className="text-xs bg-[var(--panel2)] hover:opacity-80 rounded-lg px-2.5 py-2 min-h-9">
                      סגור
                    </button>
                  ) : (
                    <button onClick={() => act("release")} disabled={busy} className="text-xs bg-[var(--accent)] text-[var(--accent-fg)] font-semibold rounded-lg px-2.5 py-2 min-h-9">
                      פתח מחדש
                    </button>
                  )}
                </div>
              </div>
            </header>

            {/* כרטיס לקוח (נפתח בלחיצה על השם) */}
            {showCard && detail && (
              <div className="shrink-0 max-h-[45%] overflow-y-auto">
                <CustomerCard
                  token={token}
                  detail={detail}
                  onSaved={() => loadDetail(conv.id)}
                  onMutate={onMutate}
                  onMarkUnread={() => {
                    setReadMap((prev) => {
                      const next = { ...prev, [conv.id]: 0 };
                      writeStorage("local", READ_KEY, JSON.stringify(next));
                      return next;
                    });
                    backToList();
                  }}
                />
              </div>
            )}

            {/* סיכום הסלמה */}
            {conv.escalationSummary && (
              <div className="mx-3 mt-2 shrink-0 text-xs bg-amber-500/10 border border-amber-500/25 rounded-xl p-2.5 text-amber-200">
                <span className="font-semibold">📋 סיכום לנציג:</span> {conv.escalationSummary}
              </div>
            )}

            {/* הודעות */}
            <div className="relative flex-1 min-h-0">
              <div
                ref={scrollRef}
                onScroll={() => {
                  const el = scrollRef.current;
                  if (!el) return;
                  nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                  if (nearBottom.current) setNewBelow(false);
                }}
                className="h-full overflow-y-auto overscroll-contain p-3 space-y-2"
              >
                {detail?.hasOlder && (
                  <div className="text-center pb-1">
                    <button
                      onClick={() => {
                        if (!selectedId) return;
                        wantAllHistory.current = true;
                        prependAdjust.current = scrollRef.current?.scrollHeight ?? null;
                        loadDetail(selectedId);
                      }}
                      className="text-[11px] text-[var(--muted)] bg-[var(--panel2)] border border-[var(--border)] rounded-full px-3 py-1.5 hover:text-[var(--text)]"
                    >
                      ↑ הצג הודעות קודמות
                    </button>
                  </div>
                )}
                {messageRows}
              </div>
              {newBelow && (
                <button
                  onClick={() => {
                    const el = scrollRef.current;
                    if (el) el.scrollTop = el.scrollHeight;
                    setNewBelow(false);
                  }}
                  className="absolute bottom-3 left-1/2 -translate-x-1/2 text-xs bg-[var(--accent)] text-[var(--accent-fg)] font-semibold rounded-full px-3 py-1.5 shadow-lg"
                >
                  הודעות חדשות ↓
                </button>
              )}
            </div>

            {/* תיבת מענה */}
            <div className="border-t border-[var(--border)] p-2.5 space-y-2 shrink-0 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
              {err && (
                <div className="text-xs text-red-400 flex items-center gap-2 flex-wrap">
                  <span>⚠ {err}</span>
                  {sendFailed && (
                    <button onClick={sendReply} disabled={busy} className="underline font-semibold">
                      נסה לשלוח שוב
                    </button>
                  )}
                </div>
              )}
              {closed ? (
                <div className="text-xs text-[var(--muted)] flex items-center gap-2 py-1">
                  השיחה סגורה - כדי לענות ללקוח, פתח אותה מחדש.
                  <button onClick={() => act("release")} disabled={busy} className="text-[var(--accent)] underline font-semibold">
                    פתח מחדש
                  </button>
                </div>
              ) : (
                <>
                  {templates.length > 0 && (
                    <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                      {templates.map((t, i) => (
                        <button
                          key={i}
                          onClick={() => updateReply((reply ? reply + " " : "") + t.text)}
                          title={t.text}
                          className="shrink-0 text-xs bg-[var(--panel2)] hover:bg-[var(--accent)] hover:text-[var(--accent-fg)] border border-[var(--border)] rounded-full px-3 py-1.5 transition"
                        >
                          {t.title || t.text.slice(0, 20)}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2 items-end">
                    <button
                      onClick={polishText}
                      disabled={suggesting || busy || !reply.trim()}
                      title="משפר את הניסוח של מה שכתבת - בלי לשנות את התוכן"
                      className="shrink-0 text-xs border border-[var(--border)] text-[var(--accent)] rounded-xl px-2.5 min-h-11 hover:bg-[var(--panel2)] disabled:opacity-50"
                    >
                      {suggesting ? "…" : "✨ נסח"}
                    </button>
                    <textarea
                      ref={textareaRef}
                      value={reply}
                      onChange={(e) => updateReply(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          sendReply();
                        }
                      }}
                      rows={1}
                      placeholder="כתוב תשובה כנציג…"
                      aria-label="תשובה ללקוח"
                      className="flex-1 resize-none bg-[var(--panel2)] border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)] max-h-32"
                    />
                    <button
                      onClick={sendReply}
                      disabled={busy || !reply.trim()}
                      className="bg-[var(--accent)] text-[var(--accent-fg)] font-semibold rounded-xl px-4 min-h-11 text-sm disabled:opacity-40"
                    >
                      {busy ? "שולח…" : "שלח"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/* ============================== כרטיס לקוח ============================== */

function CustomerCard({
  token,
  detail,
  onSaved,
  onMutate,
  onMarkUnread,
}: {
  token: string;
  detail: Detail;
  onSaved: () => void;
  onMutate: () => void;
  onMarkUnread: () => void;
}) {
  const cust = detail.customer;
  const [name, setName] = useState(cust?.name ?? "");
  const [notes, setNotes] = useState(cust?.notes ?? "");
  const [vip, setVip] = useState(!!cust?.vip);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  const [enrichment, setEnrichment] = useState<CustomerEnrichment | null>(null);

  useEffect(() => {
    setName(cust?.name ?? "");
    setNotes(cust?.notes ?? "");
    setVip(!!cust?.vip);
  }, [cust?.id, cust?.name, cust?.notes, cust?.vip]);

  // העשרה (הזמנה פעילה, ספירת שיחות, מאז/אחרון) - נטענת בקריאה נפרדת קלה
  useEffect(() => {
    const id = cust?.id;
    if (!id) return;
    let alive = true;
    setEnrichment(null);
    api<CustomerEnrichment>(token, `/customer/${encodeURIComponent(id)}`)
      .then((e) => alive && setEnrichment(e))
      .catch(() => alive && setEnrichment(null));
    return () => {
      alive = false;
    };
  }, [cust?.id, token]);

  if (!cust) return null;

  async function save(patch: Record<string, unknown>) {
    setSaving(true);
    setSaveErr("");
    try {
      await api(token, `/customer/${encodeURIComponent(cust!.id)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      onSaved();
      onMutate();
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "שמירה נכשלה");
    } finally {
      setSaving(false);
    }
  }

  // ערכים נגזרים לתצוגה
  const mem = parseMemory(cust.memory);
  const lang = detectCustomerLang(detail.messages);
  const res = enrichment?.activeReservation ?? null;
  const phone = enrichment?.phone ?? null;
  const hasBotMemory = mem.warnings.length > 0 || !!mem.preferences || !!mem.general;
  const showRegularChip = !vip && (enrichment?.conversationCount ?? 0) >= 3;

  return (
    <div className="mx-3 mt-2 bg-[var(--panel2)] border border-[var(--border)] rounded-xl p-3 text-sm space-y-3">
      {/* ---- זהות: שם + טלפון + VIP ---- */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() !== (cust.name ?? "") && save({ name: name.trim() })}
            placeholder="שם הלקוח…"
            className="w-full bg-[var(--panel)] border border-[var(--border)] rounded-lg px-2 py-1 text-sm font-semibold outline-none focus:border-[var(--accent)]"
          />
          {phone && (
            <a
              href={telHref(phone)}
              className="inline-flex items-center gap-1 text-[var(--accent)] text-xs mt-1 hover:underline"
              dir="ltr"
              title="חייג ללקוח"
            >
              📞 {formatPhone(phone)}
            </a>
          )}
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <button
            onClick={() => {
              const next = !vip;
              setVip(next);
              save({ vip: next });
            }}
            className={`text-xl leading-none transition ${vip ? "" : "opacity-25 grayscale hover:opacity-60"}`}
            title={vip ? "לקוח VIP (לחץ להסרה)" : "סמן כ-VIP"}
            aria-label="VIP"
          >
            ⭐
          </button>
          <button
            onClick={onMarkUnread}
            className="text-[11px] text-[var(--muted)] hover:text-[var(--text)] border border-[var(--border)] rounded-md px-2 py-1 whitespace-nowrap"
          >
            סמן כלא נקרא
          </button>
        </div>
      </div>

      {/* ---- שורת עובדות: קבוע/מאז/שיחות/אחרון/שפה ---- */}
      {enrichment && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--muted)]">
          {showRegularChip && (
            <span className="rounded-full bg-[var(--accent)]/15 text-[var(--accent)] px-1.5 py-0.5 font-medium">
              קבוע
            </span>
          )}
          <span>מאז {sinceLabel(enrichment.firstSeen)}</span>
          <span aria-hidden>·</span>
          <span>{enrichment.conversationCount} שיחות</span>
          <span aria-hidden>·</span>
          <span>פעם אחרונה {relTime(enrichment.lastSeen)}</span>
          {lang === "en" && (
            <span className="rounded-full border border-[var(--border)] px-1.5 py-0.5">🌐 אנגלית</span>
          )}
        </div>
      )}

      {/* ---- הזמנה פעילה (חיה ממערכת ההזמנות) ---- */}
      {res && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2.5 py-2">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-xs font-medium text-[var(--text)]">📅 הזמנה פעילה</span>
            <span
              className={`text-[10px] rounded-full px-1.5 py-0.5 font-medium ${
                res.status === "approved"
                  ? "bg-emerald-500/15 text-emerald-600"
                  : "bg-amber-500/15 text-amber-600"
              }`}
            >
              {res.status === "approved" ? "אושרה" : "ממתינה"}
            </span>
          </div>
          <div className="text-xs text-[var(--text)] flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span>{res.whenLabel}</span>
            <span className="text-[var(--muted)]" aria-hidden>·</span>
            <span>{res.time}</span>
            <span className="text-[var(--muted)]" aria-hidden>·</span>
            <span>{res.people} אנשים</span>
            {res.seating && (
              <>
                <span className="text-[var(--muted)]" aria-hidden>·</span>
                <span>ישיבה {res.seating}</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* ---- אזהרות (מודגש) ---- */}
      {mem.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-400/10 px-2.5 py-2">
          <div className="text-xs font-semibold text-amber-600 mb-1">⚠️ לשים לב</div>
          <ul className="space-y-0.5">
            {mem.warnings.map((w, i) => (
              <li key={i} className="text-xs text-[var(--text)] flex gap-1.5">
                <span className="text-amber-600 shrink-0" aria-hidden>•</span>
                <span className="min-w-0">{w}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---- הערות צוות ---- */}
      <div>
        <div className="text-[var(--muted)] text-xs mb-1">📝 הערות צוות</div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== (cust.notes ?? "") && save({ notes })}
          rows={2}
          placeholder="הערות שרק הצוות רואה…"
          className="w-full bg-[var(--panel)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]"
        />
      </div>

      {/* ---- ניקוי זיכרון הבוט ---- */}
      {hasBotMemory && (
        <button
          onClick={() => confirm("לנקות את מה שהבוט זוכר על הלקוח (אזהרות והעדפות)?") && save({ memory: "" })}
          className="text-[11px] text-[var(--muted)] hover:text-[var(--text)] border border-[var(--border)] rounded-md px-2 py-1"
        >
          🧠 נקה את זיכרון הבוט
        </button>
      )}

      {saving && <div className="text-[10px] text-[var(--muted)]">שומר…</div>}
      {saveErr && <div className="text-[10px] text-red-400">⚠ {saveErr}</div>}
    </div>
  );
}
