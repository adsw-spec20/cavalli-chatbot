/** טיפוסים, עזרי-API ופונקציות משותפות לכל מסכי פאנל הניהול. */
import type { BusinessConfig } from "@/lib/business-config";

export type { BusinessConfig };

export interface ConvItem {
  id: string;
  channel: string;
  status: string;
  escalated?: boolean;
  escalationReason?: string;
  urgent?: boolean;
  botPaused?: boolean;
  customerName?: string;
  customerId: string;
  vip?: boolean;
  tags?: string[];
  updatedAt: number;
  lastMessage?: string;
  lastUserTs?: number;
  messageCount: number;
  awaiting: boolean;
}

export interface MediaItem {
  id: string;
  label: string;
  keywords: string;
  url: string;
  type: "image" | "video";
}

export interface ChannelHealth {
  channel: string;
  configured: boolean;
  lastInbound?: number;
}

export interface DetailCustomer {
  id: string;
  channelUserId: string;
  name?: string;
  vip?: boolean;
  tags?: string[];
  notes?: string;
  /** "כרטיס זיכרון" שהבוט מתחזק על הלקוח (משיחות קודמות) */
  memory?: string;
}
export interface DetailMessage {
  id: string;
  role: string;
  content: string;
  ts: number;
  meta?: Record<string, unknown>;
}
export interface Detail {
  conversation: {
    id: string;
    status: string;
    channel: string;
    customerId: string;
    botPaused?: boolean;
    escalationReason?: string;
    escalationSummary?: string;
  };
  customer: DetailCustomer | null;
  messages: DetailMessage[];
}

export interface Stats {
  totalConversations: number;
  byStatus: { bot: number; human: number; closed: number };
  escalated: number;
  deflectionRate: number;
  totalUserMessages: number;
  last7Days: { date: string; count: number }[];
  topWords: { word: string; count: number }[];
  byChannel: { channel: string; count: number }[];
  peakHours: { hour: number; count: number }[];
  needsAttention: number;
  openQuestions: number;
  awaitingReplies: number;
}

export interface LearnedQA {
  id: string;
  question: string;
  answer: string | null;
  status: string;
  createdAt: number;
  answeredAt?: number;
  updatedAt?: number;
}

export interface QuickReply {
  title: string;
  text: string;
}

export const CHANNELS: Record<
  string,
  { label: string; dot: string; chip: string }
> = {
  whatsapp: { label: "וואטסאפ", dot: "bg-emerald-500", chip: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/20" },
  messenger: { label: "מסנג'ר", dot: "bg-blue-500", chip: "bg-blue-500/15 text-blue-300 border border-blue-500/20" },
  instagram: { label: "אינסטגרם", dot: "bg-pink-500", chip: "bg-pink-500/15 text-pink-300 border border-pink-500/20" },
  playground: { label: "בדיקה", dot: "bg-neutral-400", chip: "bg-neutral-500/15 text-neutral-300 border border-neutral-500/20" },
};

export const STATUS_LABEL: Record<string, string> = {
  bot: "בוט עונה",
  human: "נציג מטפל",
  closed: "נסגרה",
};

/** קריאת API מאומתת לפאנל. זורק שגיאה עם הודעה אם נכשל. */
export async function api<T = unknown>(
  token: string,
  path: string,
  opts?: RequestInit
): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    ...opts,
    headers: {
      "x-admin-token": token,
      "Content-Type": "application/json",
      ...((opts?.headers as Record<string, string>) || {}),
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function relTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "עכשיו";
  const m = Math.floor(s / 60);
  if (m < 60) return `לפני ${m} ד'`;
  const h = Math.floor(m / 60);
  if (h < 24) return `לפני ${h} ש'`;
  return `לפני ${Math.floor(h / 24)} י'`;
}

/** משך המתנה אנושי, לחישוב "כמה זמן הלקוח מחכה". */
export function waitLabel(ts?: number): string | null {
  if (!ts) return null;
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "כעת";
  if (m < 60) return `${m} דק'`;
  const h = Math.floor(m / 60);
  return `${h}ש ${m % 60}ד`;
}

/** עוצמת דחיפות לפי זמן המתנה (לצביעת אינדיקטור). */
export function waitSeverity(ts?: number): "none" | "ok" | "warn" | "urgent" {
  if (!ts) return "none";
  const m = (Date.now() - ts) / 60000;
  if (m < 3) return "ok";
  if (m < 10) return "warn";
  return "urgent";
}
