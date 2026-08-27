/**
 * מימוש Repository מבוסס-קובץ JSON, לפיתוח ובדיקות מקומיות.
 *
 * שומר הכל בקובץ אחד (.data/store.json). פשוט, בלי תלויות, ומתמיד בין הרצות.
 * ⚠️ לא מתאים לפרודקשן על Vercel (filesystem ארעי). שם נחליף ל-Postgres,
 *    מאחורי אותו ממשק Repository בדיוק.
 */

import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type {
  Conversation,
  ConversationFilter,
  ConversationSummary,
  Customer,
  GateEvent,
  LearnedQA,
  Repository,
  StoredMessage,
} from "./types";

interface StoreShape {
  customers: Record<string, Customer>;
  conversations: Record<string, Conversation>;
  messages: StoredMessage[];
  learnedQA: LearnedQA[];
  settings: Record<string, string>;
}

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "store.json");

function emptyStore(): StoreShape {
  return {
    customers: {},
    conversations: {},
    messages: [],
    learnedQA: [],
    settings: {},
  };
}

export class FileRepository implements Repository {
  private cache: StoreShape | null = null;
  /** שרשרת כתיבה כדי למנוע מרוצי-כתיבה (writes race) */
  private writeChain: Promise<void> = Promise.resolve();

  private async load(): Promise<StoreShape> {
    if (this.cache) return this.cache;
    let store: StoreShape;
    try {
      const raw = await fs.readFile(DATA_FILE, "utf8");
      store = { ...emptyStore(), ...JSON.parse(raw) };
    } catch {
      store = emptyStore();
    }
    this.cache = store;
    return store;
  }

  private async persist(): Promise<void> {
    const snapshot = JSON.stringify(this.cache, null, 2);
    this.writeChain = this.writeChain.then(async () => {
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(DATA_FILE, snapshot, "utf8");
    });
    return this.writeChain;
  }

  async upsertCustomer(
    input: Omit<Customer, "firstSeen" | "lastSeen"> &
      Partial<Pick<Customer, "firstSeen" | "lastSeen">>
  ): Promise<Customer> {
    const store = await this.load();
    const now = Date.now();
    const existing = store.customers[input.id];
    const customer: Customer = {
      ...existing,
      ...input,
      name: input.name ?? existing?.name, // לא לדרוס שם קיים אם לא הגיע שם חדש
      firstSeen: existing?.firstSeen ?? input.firstSeen ?? now,
      lastSeen: now,
    };
    store.customers[customer.id] = customer;
    await this.persist();
    return customer;
  }

  async getCustomer(id: string): Promise<Customer | null> {
    const store = await this.load();
    return store.customers[id] ?? null;
  }

  async updateCustomer(
    id: string,
    patch: Partial<Customer>
  ): Promise<Customer | null> {
    const store = await this.load();
    const existing = store.customers[id];
    if (!existing) return null;
    const updated: Customer = { ...existing, ...patch };
    store.customers[id] = updated;
    await this.persist();
    return updated;
  }

  async createConversation(
    data: Omit<Conversation, "createdAt" | "updatedAt">
  ): Promise<Conversation> {
    const store = await this.load();
    // אידמפוטנטי כמו בפרודקשן: מזהה קיים מחזיר את השיחה הקיימת
    const existing = store.conversations[data.id];
    if (existing) return existing;
    const now = Date.now();
    const conversation: Conversation = { ...data, createdAt: now, updatedAt: now };
    store.conversations[conversation.id] = conversation;
    await this.persist();
    return conversation;
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const store = await this.load();
    return store.conversations[id] ?? null;
  }

  async updateConversation(
    id: string,
    patch: Partial<Conversation>
  ): Promise<Conversation | null> {
    const store = await this.load();
    const existing = store.conversations[id];
    if (!existing) return null;
    const updated: Conversation = { ...existing, ...patch, updatedAt: Date.now() };
    store.conversations[id] = updated;
    await this.persist();
    return updated;
  }

  async listConversations(
    filter: ConversationFilter = {}
  ): Promise<Conversation[]> {
    const store = await this.load();
    return Object.values(store.conversations)
      .filter((c) => (filter.status ? c.status === filter.status : true))
      .filter((c) => (filter.channel ? c.channel === filter.channel : true))
      .filter((c) =>
        filter.escalated !== undefined ? !!c.escalated === filter.escalated : true
      )
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async deleteConversation(id: string): Promise<void> {
    const store = await this.load();
    const conv = store.conversations[id];
    if (!conv) return;
    delete store.conversations[id];
    store.messages = store.messages.filter((m) => m.conversationId !== id);
    const customerHasMore = Object.values(store.conversations).some(
      (c) => c.customerId === conv.customerId
    );
    if (!customerHasMore) delete store.customers[conv.customerId];
    await this.persist();
  }

  async getConversationSummaries(): Promise<ConversationSummary[]> {
    const store = await this.load();
    const byConv = new Map<string, StoredMessage[]>();
    for (const m of store.messages) {
      const arr = byConv.get(m.conversationId);
      if (arr) arr.push(m);
      else byConv.set(m.conversationId, [m]);
    }
    return Object.values(store.conversations)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((conversation) => {
        const msgs = (byConv.get(conversation.id) ?? []).sort((a, b) => a.ts - b.ts);
        const lastNonSystem = [...msgs].reverse().find((m) => m.role !== "system");
        const lastUser = [...msgs].reverse().find((m) => m.role === "user");
        const cust = store.customers[conversation.customerId];
        return {
          conversation,
          customerName: cust?.name,
          customerVip: cust?.vip,
          customerTags: cust?.tags,
          lastMessage: lastNonSystem?.content.slice(0, 80),
          lastMessageRole: lastNonSystem?.role,
          lastUserTs: lastUser?.ts,
          messageCount: msgs.length,
        };
      });
  }

  async addMessage(msg: Omit<StoredMessage, "id">): Promise<StoredMessage | null> {
    const store = await this.load();
    // שיקוף אינדקסי הייחודיות של פרודקשן: mid כפול או claim תפוס -> null
    const mid = msg.meta?.mid;
    if (mid && store.messages.some((m) => m.meta?.mid === mid)) return null;
    const retryOf = (msg.meta as Record<string, unknown> | undefined)?.gateRetryOf;
    if (
      retryOf &&
      store.messages.some((m) => (m.meta as Record<string, unknown> | undefined)?.gateRetryOf === retryOf)
    ) {
      return null;
    }
    const message: StoredMessage = { ...msg, id: randomUUID() };
    store.messages.push(message);
    const conv = store.conversations[msg.conversationId];
    if (conv) conv.updatedAt = Date.now();
    await this.persist();
    return message;
  }

  async mergeConversationInto(fromId: string, toId: string): Promise<void> {
    const store = await this.load();
    if (fromId === toId || !store.conversations[toId]) return;
    let maxTs = 0;
    for (const m of store.messages) {
      if (m.conversationId === fromId) m.conversationId = toId;
      if (m.conversationId === toId) maxTs = Math.max(maxTs, m.ts);
    }
    const from = store.conversations[fromId];
    const to = store.conversations[toId];
    to.updatedAt = Math.max(to.updatedAt, from?.updatedAt ?? 0, maxTs);
    delete store.conversations[fromId];
    await this.persist();
  }

  async dedupeMessagesByMid(conversationId: string): Promise<number> {
    const store = await this.load();
    const seen = new Set<string>();
    const before = store.messages.length;
    store.messages = store.messages
      .slice()
      .sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id))
      .filter((m) => {
        const mid =
          m.conversationId === conversationId ? (m.meta?.mid as string | undefined) : undefined;
        if (!mid) return true;
        if (seen.has(mid)) return false;
        seen.add(mid);
        return true;
      });
    const removed = before - store.messages.length;
    if (removed) await this.persist();
    return removed;
  }

  async repairConversationAfterMerge(
    id: string,
    status?: "bot" | "human" | "closed"
  ): Promise<void> {
    const store = await this.load();
    const conv = store.conversations[id];
    if (!conv) return;
    if (status) conv.status = status;
    const maxTs = store.messages
      .filter((m) => m.conversationId === id)
      .reduce((acc, m) => Math.max(acc, m.ts), 0);
    conv.updatedAt = maxTs || conv.createdAt;
    await this.persist();
  }

  async listGateEvents(limit: number): Promise<GateEvent[]> {
    const store = await this.load();
    return store.messages
      .filter((m) => {
        const meta = m.meta as Record<string, unknown> | undefined;
        return meta?.gateOpened === true || meta?.gateBlocked === true || meta?.gateError === true;
      })
      .sort((a, b) => b.ts - a.ts)
      .slice(0, limit)
      .map((m) => {
        const meta = m.meta as Record<string, unknown>;
        const conv = store.conversations[m.conversationId];
        const customer = conv ? store.customers[conv.customerId] : undefined;
        return {
          ts: m.ts,
          conversationId: m.conversationId,
          customerName: customer?.name,
          channel: conv?.channel ?? "?",
          result: meta.gateOpened === true ? "opened" : meta.gateError === true ? "error" : "blocked",
          detail: m.content.slice(0, 200),
        } as GateEvent;
      });
  }

  async getMessages(
    conversationId: string,
    opts?: { limit?: number }
  ): Promise<StoredMessage[]> {
    const store = await this.load();
    const all = store.messages
      .filter((m) => m.conversationId === conversationId)
      .sort((a, b) => a.ts - b.ts);
    return opts?.limit ? all.slice(-opts.limit) : all;
  }

  async getAllMessages(): Promise<StoredMessage[]> {
    const store = await this.load();
    return [...store.messages].sort((a, b) => a.ts - b.ts);
  }

  async addOpenQuestion(data: {
    question: string;
    conversationId?: string;
    askerName?: string;
    topic?: string;
  }): Promise<LearnedQA> {
    const store = await this.load();
    const qa: LearnedQA = {
      id: randomUUID(),
      question: data.question,
      answer: null,
      status: "open",
      conversationId: data.conversationId,
      createdAt: Date.now(),
      count: 1,
      askers: data.conversationId
        ? [{ conversationId: data.conversationId, name: data.askerName, ts: Date.now() }]
        : [],
      topic: data.topic,
    };
    store.learnedQA.push(qa);
    await this.persist();
    return qa;
  }

  async listLearnedQA(status?: "open" | "answered"): Promise<LearnedQA[]> {
    const store = await this.load();
    return store.learnedQA
      .filter((q) => (status ? q.status === status : true))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async answerLearnedQA(id: string, answer: string): Promise<LearnedQA | null> {
    const store = await this.load();
    const qa = store.learnedQA.find((q) => q.id === id);
    if (!qa) return null;
    qa.answer = answer;
    qa.status = "answered";
    qa.answeredAt = Date.now();
    await this.persist();
    return qa;
  }

  async updateLearnedQA(
    id: string,
    patch: { question?: string; answer?: string }
  ): Promise<LearnedQA | null> {
    const store = await this.load();
    const qa = store.learnedQA.find((q) => q.id === id);
    if (!qa) return null;
    if (typeof patch.question === "string" && patch.question.trim())
      qa.question = patch.question.trim();
    if (typeof patch.answer === "string" && patch.answer.trim()) {
      qa.answer = patch.answer.trim();
      if (qa.status === "open") {
        qa.status = "answered";
        qa.answeredAt = Date.now();
      }
    }
    qa.updatedAt = Date.now();
    await this.persist();
    return qa;
  }

  async recordLearnedQAAsk(id: string, asker: import("./types").QAAsker): Promise<void> {
    const store = await this.load();
    const qa = store.learnedQA.find((q) => q.id === id);
    if (!qa) return;
    qa.count = (qa.count ?? 1) + 1;
    qa.askers = [...(qa.askers ?? []), asker].slice(-20);
    await this.persist();
  }

  async setLearnedQAAskers(id: string, askers: import("./types").QAAsker[]): Promise<void> {
    const store = await this.load();
    const qa = store.learnedQA.find((q) => q.id === id);
    if (!qa) return;
    qa.askers = askers;
    await this.persist();
  }

  async deleteLearnedQA(id: string): Promise<void> {
    const store = await this.load();
    store.learnedQA = store.learnedQA.filter((q) => q.id !== id);
    await this.persist();
  }

  async getSetting(key: string): Promise<string | null> {
    const store = await this.load();
    return store.settings[key] ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    const store = await this.load();
    store.settings[key] = value;
    await this.persist();
  }
}
