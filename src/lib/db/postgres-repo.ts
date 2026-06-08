/**
 * מימוש Repository מעל Postgres (Neon), לפרודקשן על Vercel.
 *
 * אותו ממשק בדיוק כמו FileRepository, אז שאר המערכת לא יודעת ולא מתעניינת.
 * משתמש ב-@neondatabase/serverless (מנהל התקן HTTP שמתאים ל-Functions בלי
 * בעיות connection pooling). הטבלאות נוצרות אוטומטית בקריאה הראשונה.
 */

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type {
  Conversation,
  ConversationFilter,
  Customer,
  LearnedQA,
  Repository,
  StoredMessage,
} from "./types";
import type { Channel } from "../channels/types";

export class PostgresRepository implements Repository {
  private sql: NeonQueryFunction<false, false>;
  private ready: Promise<void> | null = null;

  constructor(url: string) {
    this.sql = neon(url);
  }

  private init(): Promise<void> {
    if (!this.ready) this.ready = this.migrate();
    return this.ready;
  }

  private async migrate(): Promise<void> {
    await this.sql`CREATE TABLE IF NOT EXISTS customers (
      id text PRIMARY KEY,
      channel text NOT NULL,
      channel_user_id text NOT NULL,
      name text,
      vip boolean,
      opt_in_marketing boolean,
      first_seen bigint NOT NULL,
      last_seen bigint NOT NULL,
      notes text
    )`;
    await this.sql`CREATE TABLE IF NOT EXISTS conversations (
      id text PRIMARY KEY,
      channel text NOT NULL,
      customer_id text NOT NULL,
      status text NOT NULL,
      created_at bigint NOT NULL,
      updated_at bigint NOT NULL,
      escalated boolean,
      escalation_reason text,
      escalation_summary text,
      disclosed_ai boolean,
      csat integer,
      meta text
    )`;
    await this.sql`CREATE TABLE IF NOT EXISTS messages (
      id text PRIMARY KEY,
      conversation_id text NOT NULL,
      role text NOT NULL,
      content text NOT NULL,
      ts bigint NOT NULL,
      meta text
    )`;
    await this.sql`CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages (conversation_id)`;
    await this.sql`CREATE TABLE IF NOT EXISTS learned_qa (
      id text PRIMARY KEY,
      question text NOT NULL,
      answer text,
      status text NOT NULL,
      conversation_id text,
      created_at bigint NOT NULL,
      answered_at bigint
    )`;
  }

  private toLearnedQA(r: Record<string, unknown>): LearnedQA {
    return {
      id: r.id as string,
      question: r.question as string,
      answer: (r.answer as string) ?? null,
      status: r.status as "open" | "answered",
      conversationId: (r.conversation_id as string) ?? undefined,
      createdAt: Number(r.created_at),
      answeredAt: r.answered_at ? Number(r.answered_at) : undefined,
    };
  }

  // ---------- mappers ----------
  private parseMeta(v: unknown): Record<string, unknown> | undefined {
    if (!v) return undefined;
    if (typeof v === "object") return v as Record<string, unknown>;
    try {
      return JSON.parse(v as string);
    } catch {
      return undefined;
    }
  }

  private toCustomer(r: Record<string, unknown>): Customer {
    return {
      id: r.id as string,
      channel: r.channel as Channel,
      channelUserId: r.channel_user_id as string,
      name: (r.name as string) ?? undefined,
      vip: (r.vip as boolean) ?? undefined,
      optInMarketing: (r.opt_in_marketing as boolean) ?? undefined,
      firstSeen: Number(r.first_seen),
      lastSeen: Number(r.last_seen),
      notes: (r.notes as string) ?? undefined,
    };
  }
  private toConversation(r: Record<string, unknown>): Conversation {
    return {
      id: r.id as string,
      channel: r.channel as Channel,
      customerId: r.customer_id as string,
      status: r.status as Conversation["status"],
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
      escalated: (r.escalated as boolean) ?? undefined,
      escalationReason: (r.escalation_reason as string) ?? undefined,
      escalationSummary: (r.escalation_summary as string) ?? undefined,
      disclosedAi: (r.disclosed_ai as boolean) ?? undefined,
      csat: (r.csat as number) ?? undefined,
      meta: this.parseMeta(r.meta),
    };
  }
  private toMessage(r: Record<string, unknown>): StoredMessage {
    return {
      id: r.id as string,
      conversationId: r.conversation_id as string,
      role: r.role as StoredMessage["role"],
      content: r.content as string,
      ts: Number(r.ts),
      meta: this.parseMeta(r.meta),
    };
  }

  // ---------- customers ----------
  async upsertCustomer(
    input: Omit<Customer, "firstSeen" | "lastSeen"> &
      Partial<Pick<Customer, "firstSeen" | "lastSeen">>
  ): Promise<Customer> {
    await this.init();
    const now = Date.now();
    const rows = await this.sql`
      INSERT INTO customers (id, channel, channel_user_id, name, vip, opt_in_marketing, first_seen, last_seen, notes)
      VALUES (${input.id}, ${input.channel}, ${input.channelUserId}, ${input.name ?? null},
              ${input.vip ?? null}, ${input.optInMarketing ?? null}, ${input.firstSeen ?? now}, ${now}, ${input.notes ?? null})
      ON CONFLICT (id) DO UPDATE SET
        channel = EXCLUDED.channel,
        channel_user_id = EXCLUDED.channel_user_id,
        name = COALESCE(EXCLUDED.name, customers.name),
        vip = COALESCE(EXCLUDED.vip, customers.vip),
        opt_in_marketing = COALESCE(EXCLUDED.opt_in_marketing, customers.opt_in_marketing),
        last_seen = EXCLUDED.last_seen,
        notes = COALESCE(EXCLUDED.notes, customers.notes)
      RETURNING *`;
    return this.toCustomer(rows[0]);
  }

  async getCustomer(id: string): Promise<Customer | null> {
    await this.init();
    const rows = await this.sql`SELECT * FROM customers WHERE id = ${id}`;
    return rows[0] ? this.toCustomer(rows[0]) : null;
  }

  // ---------- conversations ----------
  async createConversation(
    data: Omit<Conversation, "createdAt" | "updatedAt">
  ): Promise<Conversation> {
    await this.init();
    const now = Date.now();
    const rows = await this.sql`
      INSERT INTO conversations (id, channel, customer_id, status, created_at, updated_at, escalated, escalation_reason, escalation_summary, disclosed_ai, csat, meta)
      VALUES (${data.id}, ${data.channel}, ${data.customerId}, ${data.status}, ${now}, ${now},
              ${data.escalated ?? null}, ${data.escalationReason ?? null}, ${data.escalationSummary ?? null},
              ${data.disclosedAi ?? null}, ${data.csat ?? null}, ${data.meta ? JSON.stringify(data.meta) : null})
      RETURNING *`;
    return this.toConversation(rows[0]);
  }

  async getConversation(id: string): Promise<Conversation | null> {
    await this.init();
    const rows = await this.sql`SELECT * FROM conversations WHERE id = ${id}`;
    return rows[0] ? this.toConversation(rows[0]) : null;
  }

  async updateConversation(
    id: string,
    patch: Partial<Conversation>
  ): Promise<Conversation | null> {
    await this.init();
    const existing = await this.getConversation(id);
    if (!existing) return null;
    const m = { ...existing, ...patch, updatedAt: Date.now() };
    const rows = await this.sql`
      UPDATE conversations SET
        status = ${m.status},
        updated_at = ${m.updatedAt},
        escalated = ${m.escalated ?? null},
        escalation_reason = ${m.escalationReason ?? null},
        escalation_summary = ${m.escalationSummary ?? null},
        disclosed_ai = ${m.disclosedAi ?? null},
        csat = ${m.csat ?? null},
        meta = ${m.meta ? JSON.stringify(m.meta) : null}
      WHERE id = ${id}
      RETURNING *`;
    return this.toConversation(rows[0]);
  }

  async listConversations(
    filter: ConversationFilter = {}
  ): Promise<Conversation[]> {
    await this.init();
    const rows = await this.sql`SELECT * FROM conversations ORDER BY updated_at DESC`;
    return rows
      .map((r) => this.toConversation(r))
      .filter((c) => (filter.status ? c.status === filter.status : true))
      .filter((c) => (filter.channel ? c.channel === filter.channel : true))
      .filter((c) =>
        filter.escalated !== undefined ? !!c.escalated === filter.escalated : true
      );
  }

  // ---------- messages ----------
  async addMessage(msg: Omit<StoredMessage, "id">): Promise<StoredMessage> {
    await this.init();
    const id = crypto.randomUUID();
    const rows = await this.sql`
      INSERT INTO messages (id, conversation_id, role, content, ts, meta)
      VALUES (${id}, ${msg.conversationId}, ${msg.role}, ${msg.content}, ${msg.ts}, ${msg.meta ? JSON.stringify(msg.meta) : null})
      RETURNING *`;
    await this.sql`UPDATE conversations SET updated_at = ${Date.now()} WHERE id = ${msg.conversationId}`;
    return this.toMessage(rows[0]);
  }

  async getMessages(conversationId: string): Promise<StoredMessage[]> {
    await this.init();
    const rows = await this.sql`SELECT * FROM messages WHERE conversation_id = ${conversationId} ORDER BY ts ASC`;
    return rows.map((r) => this.toMessage(r));
  }

  async getAllMessages(): Promise<StoredMessage[]> {
    await this.init();
    const rows = await this.sql`SELECT * FROM messages ORDER BY ts ASC`;
    return rows.map((r) => this.toMessage(r));
  }

  async addOpenQuestion(data: {
    question: string;
    conversationId?: string;
  }): Promise<LearnedQA> {
    await this.init();
    const id = crypto.randomUUID();
    const rows = await this.sql`
      INSERT INTO learned_qa (id, question, answer, status, conversation_id, created_at, answered_at)
      VALUES (${id}, ${data.question}, ${null}, ${"open"}, ${data.conversationId ?? null}, ${Date.now()}, ${null})
      RETURNING *`;
    return this.toLearnedQA(rows[0]);
  }

  async listLearnedQA(status?: "open" | "answered"): Promise<LearnedQA[]> {
    await this.init();
    const rows = status
      ? await this.sql`SELECT * FROM learned_qa WHERE status = ${status} ORDER BY created_at DESC`
      : await this.sql`SELECT * FROM learned_qa ORDER BY created_at DESC`;
    return rows.map((r) => this.toLearnedQA(r));
  }

  async answerLearnedQA(id: string, answer: string): Promise<LearnedQA | null> {
    await this.init();
    const rows = await this.sql`
      UPDATE learned_qa SET answer = ${answer}, status = ${"answered"}, answered_at = ${Date.now()}
      WHERE id = ${id} RETURNING *`;
    return rows[0] ? this.toLearnedQA(rows[0]) : null;
  }

  async deleteLearnedQA(id: string): Promise<void> {
    await this.init();
    await this.sql`DELETE FROM learned_qa WHERE id = ${id}`;
  }
}
