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
  ConversationSummary,
  Customer,
  GateEvent,
  LearnedQA,
  Repository,
  StoredMessage,
} from "./types";
import type { Channel } from "../channels/types";

/** גרסת הסכמה: חובה להעלות את המספר בכל שינוי מבנה (טבלה/עמודה/אינדקס),
    אחרת ההגירה תדולג בפרודקשן והשינוי לא ייכנס. */
const SCHEMA_VERSION = "1";

export class PostgresRepository implements Repository {
  private sql: NeonQueryFunction<false, false>;
  private ready: Promise<void> | null = null;

  constructor(url: string) {
    this.sql = neon(url);
  }

  private init(): Promise<void> {
    if (!this.ready) {
      this.ready = this.ensureSchema().catch((err) => {
        this.ready = null; // כשל זמני (רשת/DB) - הבקשה הבאה תנסה שוב במקום להיתקע לנצח
        throw err;
      });
    }
    return this.ready;
  }

  /**
   * ביצועים (זמן תגובה במובייל): ההגירה המלאה היא ~17 פקודות DDL, וכל אחת היא
   * נסיעת רשת נפרדת ל-Neon. להריץ את כולן בכל עליית שרת (cold start) הוסיף
   * שניות לבקשה הראשונה אחרי פתיחת האפליקציה. במקום זה - בדיקה אחת של גרסת
   * הסכמה, וההגירה רצה רק כשבאמת יש מה לשנות.
   */
  private async ensureSchema(): Promise<void> {
    try {
      const rows = await this.sql`SELECT value FROM settings WHERE key = 'schema_version'`;
      if (rows[0]?.value === SCHEMA_VERSION) return;
    } catch {
      // טבלת settings עוד לא קיימת (התקנה ראשונה) - ממשיכים להגירה המלאה
    }
    await this.migrate();
    await this.sql`
      INSERT INTO settings (key, value) VALUES ('schema_version', ${SCHEMA_VERSION})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
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
    await this.sql`CREATE TABLE IF NOT EXISTS settings (
      key text PRIMARY KEY,
      value text NOT NULL
    )`;
    // הוספת עמודות חדשות לטבלאות קיימות (בטוח להריץ שוב ושוב)
    await this.sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS bot_paused boolean`;
    await this.sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS tags text`;
    await this.sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS memory text`;
    await this.sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS memory_updated_at bigint`;
    await this.sql`ALTER TABLE learned_qa ADD COLUMN IF NOT EXISTS updated_at bigint`;
    await this.sql`ALTER TABLE learned_qa ADD COLUMN IF NOT EXISTS count integer`;
    await this.sql`ALTER TABLE learned_qa ADD COLUMN IF NOT EXISTS askers text`;
    await this.sql`ALTER TABLE learned_qa ADD COLUMN IF NOT EXISTS topic text`;
    // אינדקס לשאילתת הסיכום של האינבוקס (הודעה אחרונה לפי שיחה)
    await this.sql`CREATE INDEX IF NOT EXISTS idx_messages_conv_ts ON messages (conversation_id, ts DESC)`;

    // ----- אינדקסי ייחודיות (27.8): הפתרון השורשי למשלוחים כפולים של מטא -----
    // בסביבה מרובת-שרתים כל בדיקת "כבר קיים?" בקוד היא מרוץ; רק ייחודיות
    // ברמת ה-DB אטומית. בתוך try/catch בכוונה: אם קיימות כפילויות ישנות
    // (מלפני הניקוי) הבנייה נכשלת בשקט והכל ממשיך כרגיל - אחרי הניקוי
    // האתחול הבא יתפוס את האינדקס.
    try {
      // הודעת ערוץ (mid של מטא) נשמרת פעם אחת בלבד בכל המערכת
      await this.sql`CREATE UNIQUE INDEX IF NOT EXISTS uniq_messages_mid
        ON messages (((meta::jsonb)->>'mid'))
        WHERE meta IS NOT NULL AND (meta::jsonb)->>'mid' IS NOT NULL`;
      // פתיחת שער חוזרת: claim אטומי - retry אחד בלבד לכל פתיחה מקורית
      await this.sql`CREATE UNIQUE INDEX IF NOT EXISTS uniq_messages_gate_retry
        ON messages (((meta::jsonb)->>'gateRetryOf'))
        WHERE meta IS NOT NULL AND (meta::jsonb)->>'gateRetryOf' IS NOT NULL`;
    } catch (err) {
      console.error("[db] בניית אינדקסי ייחודיות נדחתה (כנראה כפילויות ישנות):", err instanceof Error ? err.message.slice(0, 200) : err);
    }
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
      updatedAt: r.updated_at ? Number(r.updated_at) : undefined,
      count: r.count ? Number(r.count) : undefined,
      askers: this.parseJsonArr(r.askers),
      topic: (r.topic as string) ?? undefined,
    };
  }

  private parseJsonArr<T>(v: unknown): T[] | undefined {
    if (!v) return undefined;
    try {
      const arr = JSON.parse(v as string);
      return Array.isArray(arr) ? arr : undefined;
    } catch {
      return undefined;
    }
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
      tags: this.parseTags(r.tags),
      optInMarketing: (r.opt_in_marketing as boolean) ?? undefined,
      firstSeen: Number(r.first_seen),
      lastSeen: Number(r.last_seen),
      notes: (r.notes as string) ?? undefined,
      memory: (r.memory as string) ?? undefined,
      memoryUpdatedAt: r.memory_updated_at ? Number(r.memory_updated_at) : undefined,
    };
  }

  private parseTags(v: unknown): string[] | undefined {
    if (!v) return undefined;
    try {
      const arr = JSON.parse(v as string);
      return Array.isArray(arr) && arr.length ? arr : undefined;
    } catch {
      return undefined;
    }
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
      botPaused: (r.bot_paused as boolean) ?? undefined,
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
    const tags = input.tags ? JSON.stringify(input.tags) : null;
    const rows = await this.sql`
      INSERT INTO customers (id, channel, channel_user_id, name, vip, tags, opt_in_marketing, first_seen, last_seen, notes)
      VALUES (${input.id}, ${input.channel}, ${input.channelUserId}, ${input.name ?? null},
              ${input.vip ?? null}, ${tags}, ${input.optInMarketing ?? null}, ${input.firstSeen ?? now}, ${now}, ${input.notes ?? null})
      ON CONFLICT (id) DO UPDATE SET
        channel = EXCLUDED.channel,
        channel_user_id = EXCLUDED.channel_user_id,
        name = COALESCE(EXCLUDED.name, customers.name),
        vip = COALESCE(EXCLUDED.vip, customers.vip),
        tags = COALESCE(EXCLUDED.tags, customers.tags),
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

  async updateCustomer(
    id: string,
    patch: Partial<Customer>
  ): Promise<Customer | null> {
    await this.init();
    const existing = await this.getCustomer(id);
    if (!existing) return null;
    const m = { ...existing, ...patch };
    const rows = await this.sql`
      UPDATE customers SET
        name = ${m.name ?? null},
        vip = ${m.vip ?? null},
        tags = ${m.tags && m.tags.length ? JSON.stringify(m.tags) : null},
        opt_in_marketing = ${m.optInMarketing ?? null},
        notes = ${m.notes ?? null},
        memory = ${m.memory ?? null},
        memory_updated_at = ${m.memoryUpdatedAt ?? null}
      WHERE id = ${id}
      RETURNING *`;
    return rows[0] ? this.toCustomer(rows[0]) : null;
  }

  // ---------- conversations ----------
  async createConversation(
    data: Omit<Conversation, "createdAt" | "updatedAt">
  ): Promise<Conversation> {
    await this.init();
    const now = Date.now();
    // אידמפוטנטי (27.8): שתי הפעלות מקבילות עם אותו מזהה דטרמיניסטי מתנגשות
    // כאן במקום ליצור שתי שיחות - המפסידה מקבלת את השורה של הזוכה.
    // DO UPDATE (ולא DO NOTHING) כדי ש-RETURNING יחזיר את השורה הקיימת בסיבוב אחד.
    const rows = await this.sql`
      INSERT INTO conversations (id, channel, customer_id, status, created_at, updated_at, escalated, escalation_reason, escalation_summary, disclosed_ai, bot_paused, csat, meta)
      VALUES (${data.id}, ${data.channel}, ${data.customerId}, ${data.status}, ${now}, ${now},
              ${data.escalated ?? null}, ${data.escalationReason ?? null}, ${data.escalationSummary ?? null},
              ${data.disclosedAi ?? null}, ${data.botPaused ?? null}, ${data.csat ?? null}, ${data.meta ? JSON.stringify(data.meta) : null})
      ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id
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
        bot_paused = ${m.botPaused ?? null},
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

  async deleteConversation(id: string): Promise<void> {
    await this.init();
    const rows = await this.sql`SELECT customer_id FROM conversations WHERE id = ${id}`;
    if (!rows[0]) return;
    const customerId = rows[0].customer_id as string;
    await this.sql`DELETE FROM messages WHERE conversation_id = ${id}`;
    await this.sql`DELETE FROM conversations WHERE id = ${id}`;
    const remaining = await this.sql`SELECT 1 FROM conversations WHERE customer_id = ${customerId} LIMIT 1`;
    if (!remaining[0]) await this.sql`DELETE FROM customers WHERE id = ${customerId}`;
  }

  async mergeConversationInto(fromId: string, toId: string): Promise<void> {
    await this.init();
    if (fromId === toId) return;
    // סדר מכוון שבטוח לכשל באמצע: קודם ההודעות עוברות, ורק אז שורת המקור
    // נמחקת - כשל באמצע משאיר לכל היותר שיחה ריקה שמיזוג חוזר מנקה.
    await this.sql`UPDATE messages SET conversation_id = ${toId} WHERE conversation_id = ${fromId}`;
    await this.sql`
      UPDATE conversations SET updated_at = GREATEST(
        updated_at,
        (SELECT COALESCE(updated_at, 0) FROM conversations WHERE id = ${fromId}),
        (SELECT COALESCE(MAX(ts), 0) FROM messages WHERE conversation_id = ${toId})
      ) WHERE id = ${toId}`;
    await this.sql`DELETE FROM conversations WHERE id = ${fromId}`;
  }

  async dedupeMessagesByMid(conversationId: string): Promise<number> {
    await this.init();
    // מוחק עותקים מאוחרים של אותו mid (משלוח כפול שנקלט פעמיים לפני
    // האינדקס) - העותק הראשון נשאר. מחזיר כמה נמחקו.
    const rows = await this.sql`
      DELETE FROM messages a USING messages b
      WHERE a.conversation_id = ${conversationId}
        AND b.conversation_id = ${conversationId}
        AND a.meta IS NOT NULL AND b.meta IS NOT NULL
        AND (a.meta::jsonb)->>'mid' IS NOT NULL
        AND (a.meta::jsonb)->>'mid' = (b.meta::jsonb)->>'mid'
        AND (a.ts > b.ts OR (a.ts = b.ts AND a.id > b.id))
      RETURNING a.id`;
    return rows.length;
  }

  async repairConversationAfterMerge(
    id: string,
    status?: "bot" | "human" | "closed"
  ): Promise<void> {
    await this.init();
    if (status) {
      await this.sql`UPDATE conversations SET status = ${status} WHERE id = ${id}`;
    }
    await this.sql`
      UPDATE conversations
      SET updated_at = COALESCE((SELECT MAX(ts) FROM messages WHERE conversation_id = ${id}), created_at)
      WHERE id = ${id}`;
  }

  async listGateEvents(limit: number): Promise<GateEvent[]> {
    await this.init();
    // נגזר ישירות מהודעות המערכת של השער - מקור אמת אחד, שורד מיזוגי שיחות.
    // הטבלה קטנה (מאות שיחות) - סריקה ישירה מספיקה, בלי אינדקס ייעודי.
    const rows = await this.sql`
      SELECT m.ts, m.content, m.meta, m.conversation_id, c.channel, cu.name AS customer_name
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      LEFT JOIN customers cu ON cu.id = c.customer_id
      WHERE m.meta IS NOT NULL AND (
        (m.meta::jsonb)->>'gateOpened' = 'true' OR
        (m.meta::jsonb)->>'gateBlocked' = 'true' OR
        (m.meta::jsonb)->>'gateError' = 'true'
      )
      ORDER BY m.ts DESC
      LIMIT ${limit}`;
    return rows.map((r) => {
      const meta = r.meta ? (JSON.parse(r.meta as string) as Record<string, unknown>) : {};
      return {
        ts: Number(r.ts),
        conversationId: r.conversation_id as string,
        customerName: (r.customer_name as string) ?? undefined,
        channel: r.channel as string,
        result: meta.gateOpened === true ? "opened" : meta.gateError === true ? "error" : "blocked",
        detail: (r.content as string).slice(0, 200),
      } as GateEvent;
    });
  }

  async getConversationSummaries(): Promise<ConversationSummary[]> {
    await this.init();
    try {
      // שאילתה אחת במקום משיכת כל ההודעות: הודעה אחרונה + זמן לקוח אחרון
      // דרך subqueries ממופתחות (idx_messages_conv_ts), ופרטי הלקוח ב-JOIN.
      // ביצועים: בלי COUNT להודעות (ה-UI לא מציג אותו וזו הייתה סריקה לכל
      // שיחה), ותקרה של 300 השיחות האחרונות - הרשימה לא תופחת לנצח עם השנים.
      const rows = await this.sql`
        SELECT c.*,
               cu.name AS cust_name, cu.vip AS cust_vip, cu.tags AS cust_tags,
               lm.content AS last_content, lm.role AS last_role,
               (SELECT MAX(ts) FROM messages m WHERE m.conversation_id = c.id AND m.role = 'user') AS last_user_ts
        FROM conversations c
        LEFT JOIN customers cu ON cu.id = c.customer_id
        LEFT JOIN LATERAL (
          SELECT content, role FROM messages m
          WHERE m.conversation_id = c.id AND m.role <> 'system'
          ORDER BY m.ts DESC LIMIT 1
        ) lm ON true
        ORDER BY c.updated_at DESC
        LIMIT 300`;
      return rows.map((r) => ({
        conversation: this.toConversation(r),
        customerName: (r.cust_name as string) ?? undefined,
        customerVip: (r.cust_vip as boolean) ?? undefined,
        customerTags: this.parseTags(r.cust_tags),
        lastMessage: r.last_content ? (r.last_content as string).slice(0, 80) : undefined,
        lastMessageRole: (r.last_role as StoredMessage["role"]) ?? undefined,
        lastUserTs: r.last_user_ts ? Number(r.last_user_ts) : undefined,
      }));
    } catch (err) {
      // רשת ביטחון: אם השאילתה המהירה נכשלת, האינבוקס ממשיך לעבוד בדרך האיטית
      console.error("[postgres] summary query failed, falling back:", err);
      return this.summariesFallback();
    }
  }

  /** חישוב סיכומים בדרך הישנה (איטית אך בדוקה) - למקרה כשל בשאילתה המהירה. */
  private async summariesFallback(): Promise<ConversationSummary[]> {
    const convs = await this.listConversations();
    const msgs = await this.getAllMessages();
    const custIds = [...new Set(convs.map((c) => c.customerId))];
    const customers = await Promise.all(custIds.map((id) => this.getCustomer(id)));
    const custById = new Map(customers.filter(Boolean).map((c) => [c!.id, c!]));
    return convs.map((conversation) => {
      const mine = msgs.filter((m) => m.conversationId === conversation.id);
      const lastNonSystem = [...mine].reverse().find((m) => m.role !== "system");
      const lastUser = [...mine].reverse().find((m) => m.role === "user");
      const cust = custById.get(conversation.customerId);
      return {
        conversation,
        customerName: cust?.name,
        customerVip: cust?.vip,
        customerTags: cust?.tags,
        lastMessage: lastNonSystem?.content.slice(0, 80),
        lastMessageRole: lastNonSystem?.role,
        lastUserTs: lastUser?.ts,
        messageCount: mine.length,
      };
    });
  }

  // ---------- messages ----------
  async addMessage(msg: Omit<StoredMessage, "id">): Promise<StoredMessage | null> {
    await this.init();
    const id = crypto.randomUUID();
    // ON CONFLICT DO NOTHING: התנגשות באינדקס ייחודיות (mid כפול ממשלוח כפול
    // של מטא, או claim של פתיחת שער שכבר נתפס) מחזירה null - האות למי שקרא
    // ששרת אחר כבר מטפל באירוע הזה והוא צריך לעצור.
    const rows = await this.sql`
      INSERT INTO messages (id, conversation_id, role, content, ts, meta)
      VALUES (${id}, ${msg.conversationId}, ${msg.role}, ${msg.content}, ${msg.ts}, ${msg.meta ? JSON.stringify(msg.meta) : null})
      ON CONFLICT DO NOTHING
      RETURNING *`;
    if (!rows[0]) return null;
    await this.sql`UPDATE conversations SET updated_at = ${Date.now()} WHERE id = ${msg.conversationId}`;
    return this.toMessage(rows[0]);
  }

  async getMessages(
    conversationId: string,
    opts?: { limit?: number }
  ): Promise<StoredMessage[]> {
    await this.init();
    if (opts?.limit) {
      // N האחרונות (ממופתח idx_messages_conv_ts) ואז היפוך לסדר כרונולוגי -
      // שיחת וואטסאפ ותיקה עם מאות הודעות לא נמשכת כולה לפאנל בכל רענון
      const rows = await this.sql`
        SELECT * FROM messages WHERE conversation_id = ${conversationId}
        ORDER BY ts DESC LIMIT ${opts.limit}`;
      return rows.map((r) => this.toMessage(r)).reverse();
    }
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
    askerName?: string;
    topic?: string;
  }): Promise<LearnedQA> {
    await this.init();
    const id = crypto.randomUUID();
    const rows = await this.sql`
      INSERT INTO learned_qa (id, question, answer, status, conversation_id, created_at, answered_at, count, askers, topic)
      VALUES (${id}, ${data.question}, ${null}, ${"open"}, ${data.conversationId ?? null}, ${Date.now()}, ${null},
              ${1}, ${JSON.stringify(data.conversationId ? [{ conversationId: data.conversationId, name: data.askerName, ts: Date.now() }] : [])}, ${data.topic ?? null})
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

  async updateLearnedQA(
    id: string,
    patch: { question?: string; answer?: string }
  ): Promise<LearnedQA | null> {
    await this.init();
    const rows = await this.sql`SELECT * FROM learned_qa WHERE id = ${id}`;
    if (!rows[0]) return null;
    const existing = this.toLearnedQA(rows[0]);
    const question =
      typeof patch.question === "string" && patch.question.trim()
        ? patch.question.trim()
        : existing.question;
    const answer =
      typeof patch.answer === "string" && patch.answer.trim()
        ? patch.answer.trim()
        : existing.answer;
    // מענה ראשון לשאלה פתוחה דרך עריכה נחשב כ"נענתה"
    const becomesAnswered = existing.status === "open" && !!answer;
    const updated = await this.sql`
      UPDATE learned_qa SET
        question = ${question},
        answer = ${answer},
        status = ${becomesAnswered ? "answered" : existing.status},
        answered_at = ${becomesAnswered ? Date.now() : existing.answeredAt ?? null},
        updated_at = ${Date.now()}
      WHERE id = ${id} RETURNING *`;
    return updated[0] ? this.toLearnedQA(updated[0]) : null;
  }

  async recordLearnedQAAsk(id: string, asker: import("./types").QAAsker): Promise<void> {
    await this.init();
    const rows = await this.sql`SELECT count, askers FROM learned_qa WHERE id = ${id}`;
    if (!rows[0]) return;
    const count = (rows[0].count ? Number(rows[0].count) : 1) + 1;
    const askers = [...(this.parseJsonArr<import("./types").QAAsker>(rows[0].askers) ?? []), asker].slice(-20);
    await this.sql`UPDATE learned_qa SET count = ${count}, askers = ${JSON.stringify(askers)} WHERE id = ${id}`;
  }

  async setLearnedQAAskers(id: string, askers: import("./types").QAAsker[]): Promise<void> {
    await this.init();
    await this.sql`UPDATE learned_qa SET askers = ${JSON.stringify(askers)} WHERE id = ${id}`;
  }

  async deleteLearnedQA(id: string): Promise<void> {
    await this.init();
    await this.sql`DELETE FROM learned_qa WHERE id = ${id}`;
  }

  async getSetting(key: string): Promise<string | null> {
    await this.init();
    const rows = await this.sql`SELECT value FROM settings WHERE key = ${key}`;
    return rows[0] ? (rows[0].value as string) : null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.init();
    await this.sql`
      INSERT INTO settings (key, value) VALUES (${key}, ${value})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
  }
}
