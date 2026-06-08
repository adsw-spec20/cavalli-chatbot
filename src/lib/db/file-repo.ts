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
  Customer,
  Repository,
  StoredMessage,
} from "./types";

interface StoreShape {
  customers: Record<string, Customer>;
  conversations: Record<string, Conversation>;
  messages: StoredMessage[];
}

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "store.json");

function emptyStore(): StoreShape {
  return { customers: {}, conversations: {}, messages: [] };
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
}
