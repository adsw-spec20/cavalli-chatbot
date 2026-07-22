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

  async addMessage(msg: Omit<StoredMessage, "id">): Promise<StoredMessage> {
    const store = await this.load();
    const message: StoredMessage = { ...msg, id: randomUUID() };
    store.messages.push(message);
    const conv = store.conversations[msg.conversationId];
    if (conv) conv.updatedAt = Date.now();
    await this.persist();
    return message;
  }

  async getMessages(conversationId: string): Promise<StoredMessage[]> {
    const store = await this.load();
    return store.messages
      .filter((m) => m.conversationId === conversationId)
      .sort((a, b) => a.ts - b.ts);
  }

  async getAllMessages(): Promise<StoredMessage[]> {
    const store = await this.load();
    return [...store.messages].sort((a, b) => a.ts - b.ts);
  }

  async addOpenQuestion(data: {
    question: string;
    conversationId?: string;
  }): Promise<LearnedQA> {
    const store = await this.load();
    const qa: LearnedQA = {
      id: randomUUID(),
      question: data.question,
      answer: null,
      status: "open",
      conversationId: data.conversationId,
      createdAt: Date.now(),
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
