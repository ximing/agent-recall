import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  displayName: varchar('display_name', { length: 64 }),
  createdAt: timestamptz('created_at').notNull(),
  updatedAt: timestamptz('updated_at').notNull(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  expiresAt: timestamptz('expires_at').notNull(),
  createdAt: timestamptz('created_at').notNull(),
});

export const accessTokens = pgTable('access_tokens', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 80 }).notNull(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  preview: varchar('preview', { length: 32 }).notNull(),
  revokedAt: timestamptz('revoked_at'),
  createdAt: timestamptz('created_at').notNull(),
});

export const mcpClients = pgTable('mcp_clients', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 80 }).notNull(),
  tokenId: uuid('token_id')
    .notNull()
    .references(() => accessTokens.id, { onDelete: 'cascade' }),
  revokedAt: timestamptz('revoked_at'),
  createdAt: timestamptz('created_at').notNull(),
});

export const memories = pgTable(
  'memories',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    origin: varchar('origin', { length: 16 }).notNull(),
    type: varchar('type', { length: 24 }).notNull().default('fact'),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    project: varchar('project', { length: 128 }),
    sessionId: varchar('session_id', { length: 128 }),
    eventId: varchar('event_id', { length: 128 }),
    /** 规范化内容的 sha256，用于短时间窗口去重 */
    contentHash: varchar('content_hash', { length: 64 }),
    expiresAt: timestamptz('expires_at'),
    /** 版本链：编辑产生新版本，旧版本退出检索但保留历史 */
    chainId: uuid('chain_id').notNull(),
    parentId: uuid('parent_id'),
    version: integer('version').notNull().default(1),
    isLatest: boolean('is_latest').notNull().default(true),
    /** 衰减/治理信号：被召回命中的次数与最近命中时间 */
    accessCount: integer('access_count').notNull().default(0),
    lastAccessedAt: timestamptz('last_accessed_at'),
    indexedAt: timestamptz('indexed_at'),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (table) => [
    index('memories_user_created_idx').on(table.userId, table.createdAt),
    index('memories_user_chain_idx').on(table.userId, table.chainId),
    index('memories_user_session_idx').on(table.userId, table.sessionId),
    index('memories_user_hash_idx').on(table.userId, table.contentHash),
    uniqueIndex('memories_user_event_uidx').on(table.userId, table.eventId),
  ],
);

export type MemoryRow = typeof memories.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type TokenRow = typeof accessTokens.$inferSelect;
export type McpClientRow = typeof mcpClients.$inferSelect;

export const userSettings = pgTable('user_settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  rerankEnabled: boolean('rerank_enabled').notNull().default(false),
  rerankBaseUrl: varchar('rerank_base_url', { length: 255 })
    .notNull()
    .default('https://dashscope.aliyuncs.com/api/v1'),
  rerankModel: varchar('rerank_model', { length: 80 }).notNull().default('gte-rerank-v2'),
  /** AES-256-GCM 加密存储（enc:v1:iv:tag:data），密钥来自 ENCRYPTION_KEY */
  rerankApiKey: varchar('rerank_api_key', { length: 512 }),
  /** 自动遗忘阈值天数：hook 碎片超过该天数且从未被召回命中则清除，0 = 禁用 */
  autoForgetDays: integer('auto_forget_days').notNull().default(0),
  updatedAt: timestamptz('updated_at').notNull(),
});

export type UserSettingsRow = typeof userSettings.$inferSelect;

export const recallLogs = pgTable(
  'recall_logs',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    query: text('query').notNull(),
    strategy: varchar('strategy', { length: 16 }).notNull(),
    rerankModel: varchar('rerank_model', { length: 80 }),
    rerankApplied: boolean('rerank_applied').notNull(),
    rerankError: text('rerank_error'),
    results: jsonb('results').$type<Array<{ id: string; content: string; score: number | null }>>().notNull(),
    latencyMs: integer('latency_ms').notNull(),
    createdAt: timestamptz('created_at').notNull(),
  },
  (table) => [index('recall_logs_user_created_idx').on(table.userId, table.createdAt)],
);

export type RecallLogRow = typeof recallLogs.$inferSelect;

/** KV 协同原语：一张表撑 slots/signals/checkpoints/leases/sentinels/actions/routines/profile */
export const kvEntries = pgTable(
  'kv_entries',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    namespace: varchar('namespace', { length: 32 }).notNull(),
    key: varchar('key', { length: 128 }).notNull(),
    value: jsonb('value').$type<unknown>().notNull(),
    expiresAt: timestamptz('expires_at'),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.namespace, table.key] }),
    index('kv_entries_user_ns_idx').on(table.userId, table.namespace),
  ],
);

export type KvEntryRow = typeof kvEntries.$inferSelect;

/** 完整 export 负载快照，可回放恢复 */
export const snapshots = pgTable(
  'snapshots',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    note: text('note'),
    memoryCount: integer('memory_count').notNull(),
    data: jsonb('data').$type<unknown>().notNull(),
    createdAt: timestamptz('created_at').notNull(),
  },
  (table) => [index('snapshots_user_created_idx').on(table.userId, table.createdAt)],
);

export type SnapshotRow = typeof snapshots.$inferSelect;

export const auditEntries = pgTable(
  'audit_entries',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    action: varchar('action', { length: 48 }).notNull(),
    detail: jsonb('detail').$type<Record<string, unknown>>(),
    createdAt: timestamptz('created_at').notNull(),
  },
  (table) => [index('audit_entries_user_created_idx').on(table.userId, table.createdAt)],
);

export type AuditEntryRow = typeof auditEntries.$inferSelect;

/** 团队分享邀请：接受前不把记忆复制进对方库 */
export const shareInvites = pgTable(
  'share_invites',
  {
    id: uuid('id').primaryKey(),
    fromUserId: uuid('from_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    toUserId: uuid('to_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    memoryId: uuid('memory_id')
      .notNull()
      .references(() => memories.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 16 }).notNull(),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('share_invites_from_memory_to_uidx').on(table.fromUserId, table.memoryId, table.toUserId),
    index('share_invites_to_status_idx').on(table.toUserId, table.status),
  ],
);

export type ShareInviteRow = typeof shareInvites.$inferSelect;

/** 用户自己的对话模型。密钥加密后入库，接口只回预览。 */
export const llmConfigs = pgTable(
  'llm_configs',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 32 }).notNull(),
    apiKeyEncrypted: text('api_key_encrypted').notNull(),
    model: varchar('model', { length: 128 }).notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    baseUrl: varchar('base_url', { length: 512 }),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (table) => [
    index('llm_configs_user_created_idx').on(table.userId, table.createdAt),
    uniqueIndex('llm_configs_user_default_uidx').on(table.userId).where(sql`${table.isDefault} = true`),
  ],
);

export type LlmConfigRow = typeof llmConfigs.$inferSelect;

export interface AgentStep {
  name: string;
  ok: boolean;
  note?: string;
}

export interface AgentTurnMeta {
  role: 'system' | 'user' | 'assistant';
  chars: number;
}

/** 一次 agent 任务。不存提示词正文，避免把记忆里的秘密写进执行记录。 */
export const agentExecutions = pgTable(
  'agent_executions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    agentType: varchar('agent_type', { length: 32 }).notNull(),
    status: varchar('status', { length: 16 }).notNull(),
    startedAt: timestamptz('started_at').notNull(),
    finishedAt: timestamptz('finished_at'),
    steps: jsonb('steps').$type<AgentStep[]>().notNull(),
    turns: jsonb('turns').$type<AgentTurnMeta[]>().notNull(),
    error: text('error'),
    resultSummary: text('result_summary'),
    createdAt: timestamptz('created_at').notNull(),
  },
  (table) => [
    index('agent_executions_user_started_idx').on(table.userId, table.startedAt),
    index('agent_executions_type_status_idx').on(table.agentType, table.status),
  ],
);

export type AgentExecutionRow = typeof agentExecutions.$inferSelect;

export const llmUsageLogs = pgTable(
  'llm_usage_logs',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    executionId: uuid('execution_id').references(() => agentExecutions.id, { onDelete: 'set null' }),
    provider: varchar('provider', { length: 32 }).notNull(),
    model: varchar('model', { length: 128 }).notNull(),
    capability: varchar('capability', { length: 16 }).notNull(),
    promptTokens: integer('prompt_tokens').notNull(),
    completionTokens: integer('completion_tokens').notNull(),
    totalTokens: integer('total_tokens').notNull(),
    costEstimate: numeric('cost_estimate', { precision: 14, scale: 8, mode: 'number' }).notNull(),
    latencyMs: integer('latency_ms'),
    createdAt: timestamptz('created_at').notNull(),
  },
  (table) => [
    index('llm_usage_logs_user_created_idx').on(table.userId, table.createdAt),
    index('llm_usage_logs_execution_idx').on(table.executionId),
    index('llm_usage_logs_capability_created_idx').on(table.capability, table.createdAt),
  ],
);

export type LlmUsageRow = typeof llmUsageLogs.$inferSelect;
