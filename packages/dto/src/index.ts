import { z } from 'zod';

export const originSchema = z.enum(['web', 'agent', 'hook', 'import', 'summary']);
export type Origin = z.infer<typeof originSchema>;

export const MEMORY_TYPES = ['fact', 'preference', 'pattern', 'architecture', 'bug', 'workflow', 'lesson'] as const;
export const memoryTypeSchema = z.enum(MEMORY_TYPES);
export type MemoryType = z.infer<typeof memoryTypeSchema>;

export const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'SessionEnd'] as const;
export const hookEventNameSchema = z.enum(HOOK_EVENTS);
export type HookEventName = z.infer<typeof hookEventNameSchema>;

export const registerSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(200),
  displayName: z.string().trim().min(1).max(64).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().nullable(),
});
export type UserPublic = z.infer<typeof userSchema>;

const tagsSchema = z.array(z.string().trim().min(1).max(48)).max(16);

export const memoryCreateSchema = z.object({
  content: z.string().trim().min(1).max(100_000),
  type: memoryTypeSchema.optional(),
  tags: tagsSchema.optional(),
  project: z.string().trim().min(1).max(128).optional(),
  sessionId: z.string().trim().min(1).max(128).optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
});
export type MemoryCreateInput = z.infer<typeof memoryCreateSchema>;

export const memoryUpdateSchema = z.object({
  content: z.string().trim().min(1).max(100_000),
  type: memoryTypeSchema.optional(),
  tags: tagsSchema.optional(),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
});
export type MemoryUpdateInput = z.infer<typeof memoryUpdateSchema>;

export const memorySchema = z.object({
  id: z.string().uuid(),
  content: z.string(),
  origin: originSchema,
  type: memoryTypeSchema,
  tags: z.array(z.string()),
  project: z.string().nullable(),
  sessionId: z.string().nullable(),
  eventId: z.string().nullable(),
  expiresAt: z.string().nullable(),
  version: z.number().int(),
  /** 版本链根 id（首版为自身 id） */
  chainId: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  isLatest: z.boolean(),
  accessCount: z.number().int(),
  lastAccessedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MemoryPublic = z.infer<typeof memorySchema>;

export const memoryFilterSchema = z.object({
  origin: z.array(originSchema).optional(),
  type: z.array(memoryTypeSchema).optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  project: z.string().trim().min(1).max(128).optional(),
  sessionId: z.string().trim().min(1).max(128).optional(),
  createdAfter: z.string().datetime({ offset: true }).optional(),
  createdBefore: z.string().datetime({ offset: true }).optional(),
  includeExpired: z.boolean().optional(),
});
export type MemoryFilter = z.infer<typeof memoryFilterSchema>;

export const recallSchema = z.object({
  query: z.string().trim().min(1).max(10_000),
  limit: z.number().int().min(1).max(50).optional(),
  filter: memoryFilterSchema.optional(),
});
export type RecallInput = z.infer<typeof recallSchema>;

export const memoryListQuerySchema = memoryFilterSchema.extend({
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
});
export type MemoryListQuery = z.infer<typeof memoryListQuerySchema>;

export const batchForgetSchema = z.object({
  ids: z.array(z.string().uuid()).max(500).optional(),
  filter: memoryFilterSchema.optional(),
  dryRun: z.boolean().optional(),
});
export type BatchForgetInput = z.infer<typeof batchForgetSchema>;

export const exportResultSchema = z.object({
  format: z.literal('agent-recall/v1'),
  exportedAt: z.string(),
  memories: z.array(memorySchema),
});
export type ExportResult = z.infer<typeof exportResultSchema>;

export const importStrategySchema = z.enum(['skip', 'merge', 'replace']);
export type ImportStrategy = z.infer<typeof importStrategySchema>;

export const importSchema = z.object({
  memories: z.array(
    z.object({
      id: z.string().uuid().optional(),
      content: z.string().trim().min(1).max(100_000),
      origin: originSchema.optional(),
      type: memoryTypeSchema.optional(),
      tags: tagsSchema.optional(),
      project: z.string().max(128).nullable().optional(),
      sessionId: z.string().max(128).nullable().optional(),
      expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
      chainId: z.string().uuid().optional(),
      parentId: z.string().uuid().nullable().optional(),
      version: z.number().int().min(1).optional(),
      isLatest: z.boolean().optional(),
      accessCount: z.number().int().min(0).optional(),
      lastAccessedAt: z.string().datetime({ offset: true }).nullable().optional(),
      createdAt: z.string().datetime({ offset: true }).optional(),
    }),
  ),
  strategy: importStrategySchema.optional(),
});
export type ImportInput = z.infer<typeof importSchema>;

export const memoryStatsSchema = z.object({
  total: z.number().int(),
  byOrigin: z.record(z.string(), z.number().int()),
  byType: z.record(z.string(), z.number().int()),
  expired: z.number().int(),
  pendingIndex: z.number().int(),
  createdLast7d: z.number().int(),
  sessions: z.number().int(),
});
export type MemoryStats = z.infer<typeof memoryStatsSchema>;

export const sessionSummarySchema = z.object({
  sessionId: z.string(),
  memoryCount: z.number().int(),
  firstAt: z.string(),
  lastAt: z.string(),
  projects: z.array(z.string()),
});
export type SessionSummaryPublic = z.infer<typeof sessionSummarySchema>;

export const tokenCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
});
export type TokenCreateInput = z.infer<typeof tokenCreateSchema>;

export const tokenSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  preview: z.string(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type TokenPublic = z.infer<typeof tokenSchema>;

export const mcpCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
});
export type McpCreateInput = z.infer<typeof mcpCreateSchema>;

export const mcpClientSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  tokenPreview: z.string(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type McpClientPublic = z.infer<typeof mcpClientSchema>;

export const hookIngestSchema = z.object({
  eventId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/),
  hook: hookEventNameSchema,
  content: z.string().trim().min(1).max(100_000),
  sessionId: z.string().trim().min(1).max(128).optional(),
  project: z.string().trim().min(1).max(128).optional(),
  toolName: z.string().trim().min(1).max(80).optional(),
  type: memoryTypeSchema.optional(),
});
export type HookIngestInput = z.infer<typeof hookIngestSchema>;

/** UserPromptSubmit / SessionStart 时钩子请求召回注入的契约 */
export const hookContextSchema = z.object({
  query: z.string().trim().min(1).max(10_000),
  /** 注入文本的 token 预算（约 4 字符 = 1 token），默认 2000 */
  tokenBudget: z.number().int().min(100).max(20_000).optional(),
  sessionId: z.string().trim().min(1).max(128).optional(),
  project: z.string().trim().min(1).max(128).optional(),
});
export type HookContextInput = z.infer<typeof hookContextSchema>;

export const hookContextResultSchema = z.object({
  /** 可直接注入 prompt 的格式化文本，空串 = 无相关记忆 */
  context: z.string(),
  memories: z.array(memorySchema),
});
export type HookContextResult = z.infer<typeof hookContextResultSchema>;

export const RERANK_DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1';
export const RERANK_DEFAULT_MODEL = 'gte-rerank-v2';

export const settingsUpdateSchema = z.object({
  rerankEnabled: z.boolean(),
  rerankBaseUrl: z.string().trim().url().max(255).optional(),
  rerankModel: z.string().trim().min(1).max(80).optional(),
  // 不传 = 保持不变；空串 = 清除已保存的 Key
  rerankApiKey: z.string().trim().max(255).optional(),
  /** 自动遗忘：hook 碎片超过该天数且从未被召回命中则清除，0 = 禁用 */
  autoForgetDays: z.number().int().min(0).max(365).optional(),
});
export type SettingsUpdateInput = z.infer<typeof settingsUpdateSchema>;

export const settingsSchema = z.object({
  rerankEnabled: z.boolean(),
  rerankBaseUrl: z.string(),
  rerankModel: z.string(),
  hasRerankApiKey: z.boolean(),
  rerankApiKeyPreview: z.string().nullable(),
  autoForgetDays: z.number().int(),
});
export type SettingsPublic = z.infer<typeof settingsSchema>;

export const autoForgetSchema = z.object({
  dryRun: z.boolean().optional(),
});
export type AutoForgetInput = z.infer<typeof autoForgetSchema>;

export const recallStrategySchema = z.enum(['rrf', 'rrf+rerank']);
export type RecallStrategy = z.infer<typeof recallStrategySchema>;export const recallLogSchema = z.object({
  id: z.string().uuid(),
  query: z.string(),
  strategy: recallStrategySchema,
  rerankModel: z.string().nullable(),
  /** 精排实际生效（false = 配置了精排但失败回退 RRF） */
  rerankApplied: z.boolean(),
  /** 精排失败原因（未尝试或成功时为 null） */
  rerankError: z.string().nullable(),
  resultCount: z.number().int(),
  /** 返回结果的快照（截断）+ 精排相关度分数，便于脱离记忆本体做事后分析 */
  results: z.array(z.object({ id: z.string(), content: z.string(), score: z.number().nullable() })),
  latencyMs: z.number().int(),
  createdAt: z.string(),
});
export type RecallLogPublic = z.infer<typeof recallLogSchema>;

// ---- KV 协同原语 ----

export const kvNamespaceSchema = z.string().regex(/^[a-z][a-z0-9_]{1,31}$/);
export const kvKeySchema = z.string().regex(/^[\w.:-]{1,128}$/);

export const kvPutSchema = z.object({
  value: z.unknown(),
  /** 秒级 TTL，到期即删 */
  ttlSeconds: z.number().int().min(1).max(31_536_000).optional(),
  /** lease 语义：已存在未过期条目时返回 409 */
  ifAbsent: z.boolean().optional(),
});
export type KvPutInput = z.infer<typeof kvPutSchema>;

export const kvAppendSchema = z.object({
  value: z.unknown(),
});
export type KvAppendInput = z.infer<typeof kvAppendSchema>;

export const kvEntrySchema = z.object({
  namespace: z.string(),
  key: z.string(),
  value: z.unknown(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type KvEntryPublic = z.infer<typeof kvEntrySchema>;

// ---- 图谱 ----

export const graphNodeSchema = z.object({
  id: z.string(),
  kind: z.enum(['memory', 'project', 'tag', 'session', 'type']),
  name: z.string(),
});
export type GraphNode = z.infer<typeof graphNodeSchema>;

export const graphEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  relation: z.enum(['has_tag', 'belongs_to', 'in_session', 'is_type']),
});
export type GraphEdge = z.infer<typeof graphEdgeSchema>;

export const graphQueryResultSchema = z.object({
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
});
export type GraphQueryResult = z.infer<typeof graphQueryResultSchema>;

// ---- 快照 ----

export const snapshotCreateSchema = z.object({
  note: z.string().trim().max(500).optional(),
});
export type SnapshotCreateInput = z.infer<typeof snapshotCreateSchema>;

export const snapshotSchema = z.object({
  id: z.string().uuid(),
  note: z.string().nullable(),
  memoryCount: z.number().int(),
  createdAt: z.string(),
});
export type SnapshotPublic = z.infer<typeof snapshotSchema>;

export const snapshotRestoreSchema = z.object({
  strategy: importStrategySchema.optional(),
});
export type SnapshotRestoreInput = z.infer<typeof snapshotRestoreSchema>;

// ---- 团队共享 ----

export const shareSchema = z.object({
  email: z.string().trim().email(),
});
export type ShareInput = z.infer<typeof shareSchema>;

export const shareResultSchema = z.object({
  shared: z.literal(true),
  delivery: z.enum(['pending', 'accepted']),
});
export type ShareResult = z.infer<typeof shareResultSchema>;

export const shareInviteSchema = z.object({
  id: z.string().uuid(),
  fromEmail: z.string().email(),
  fromDisplayName: z.string().nullable(),
  memoryId: z.string().uuid(),
  content: z.string(),
  project: z.string().nullable(),
  createdAt: z.string(),
});
export type ShareInvitePublic = z.infer<typeof shareInviteSchema>;

export const shareAcceptResultSchema = z.object({
  memory: memorySchema,
  delivery: z.literal('accepted'),
});
export type ShareAcceptResult = z.infer<typeof shareAcceptResultSchema>;

export const shareRejectResultSchema = z.object({
  delivery: z.literal('rejected'),
});
export type ShareRejectResult = z.infer<typeof shareRejectResultSchema>;

// ---- 近重复合并 ----

export const consolidateSchema = z.object({
  dryRun: z.boolean().optional(),
});
export type ConsolidateInput = z.infer<typeof consolidateSchema>;

export const semanticConsolidateSchema = z.object({
  /** true = 没有调用模型 */
  skipped: z.boolean(),
  reason: z.string().optional(),
  created: z.number().int(),
  evolved: z.number().int(),
  absorbed: z.number().int(),
  executionId: z.string().uuid().optional(),
});
export type SemanticConsolidateResult = z.infer<typeof semanticConsolidateSchema>;

export const consolidateResultSchema = z.object({
  /** 存在重复链的 contentHash 分组数 */
  groups: z.number().int(),
  /** 被合并（删除）的链数 */
  merged: z.number().int(),
  /** 用户配置了大模型时的语义合并；预览和未配置时跳过 */
  semantic: semanticConsolidateSchema,
});
export type ConsolidateResult = z.infer<typeof consolidateResultSchema>;

export const LLM_PROVIDERS = ['openai', 'deepseek', 'claude', 'zhipu', 'dashscope'] as const;
export const llmProviderSchema = z.enum(LLM_PROVIDERS);
export type LlmProvider = z.infer<typeof llmProviderSchema>;

/** OpenAI 兼容或 Anthropic 的默认根地址。自定义 baseUrl 为空时用这份。 */
export const LLM_DEFAULT_BASE_URL: Record<LlmProvider, string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com',
  claude: 'https://api.anthropic.com',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  dashscope: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
};

export const LLM_SUGGESTED_MODEL: Record<LlmProvider, string> = {
  openai: 'gpt-4o-mini',
  deepseek: 'deepseek-chat',
  claude: 'claude-sonnet-4-5',
  zhipu: 'glm-4-flash',
  dashscope: 'qwen-plus',
};

const optionalBaseUrl = z
  .string()
  .trim()
  .max(512)
  .nullable()
  .optional()
  .transform((value) => {
    if (value == null) return value;
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  })
  .refine((value) => value == null || z.string().url().safeParse(value).success, { message: 'baseUrl' });

export const createLlmConfigSchema = z.object({
  provider: llmProviderSchema,
  apiKey: z.string().trim().min(1).max(512),
  model: z.string().trim().min(1).max(128),
  isDefault: z.boolean().optional(),
  baseUrl: optionalBaseUrl,
});
export type CreateLlmConfigInput = z.infer<typeof createLlmConfigSchema>;

export const updateLlmConfigSchema = z.object({
  apiKey: z.string().trim().min(1).max(512).optional(),
  model: z.string().trim().min(1).max(128).optional(),
  baseUrl: optionalBaseUrl,
});
export type UpdateLlmConfigInput = z.infer<typeof updateLlmConfigSchema>;

export const llmConfigSchema = z.object({
  id: z.string().uuid(),
  provider: llmProviderSchema,
  model: z.string(),
  isDefault: z.boolean(),
  baseUrl: z.string().nullable(),
  apiKeyPreview: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type LlmConfigPublic = z.infer<typeof llmConfigSchema>;

export const llmTestResultSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
});
export type LlmTestResult = z.infer<typeof llmTestResultSchema>;

export const llmCapabilitySchema = z.enum(['chat', 'embed', 'rerank']);
export type LlmCapability = z.infer<typeof llmCapabilitySchema>;

export const llmUsageSchema = z.object({
  id: z.string().uuid(),
  provider: z.string(),
  model: z.string(),
  capability: llmCapabilitySchema,
  promptTokens: z.number().int(),
  completionTokens: z.number().int(),
  totalTokens: z.number().int(),
  costEstimate: z.number(),
  latencyMs: z.number().int().nullable(),
  createdAt: z.string(),
});
export type LlmUsagePublic = z.infer<typeof llmUsageSchema>;

export const llmUsageBreakdownSchema = z.object({
  capability: llmCapabilitySchema,
  calls: z.number().int(),
  promptTokens: z.number().int(),
  completionTokens: z.number().int(),
  totalTokens: z.number().int(),
  costEstimate: z.number(),
});
export type LlmUsageBreakdown = z.infer<typeof llmUsageBreakdownSchema>;

export const llmUsageListSchema = z.object({
  logs: z.array(llmUsageSchema),
  totalCost: z.number(),
  totalTokens: z.number().int(),
  byCapability: z.array(llmUsageBreakdownSchema),
});
export type LlmUsageList = z.infer<typeof llmUsageListSchema>;

// ---- 反思 ----

export const reflectSchema = z.object({
  days: z.number().int().min(1).max(90).optional(),
  project: z.string().trim().min(1).max(128).optional(),
});
export type ReflectInput = z.infer<typeof reflectSchema>;

// ---- 诊断与自愈 ----

export const diagnoseProblemSchema = z.object({
  code: z.string(),
  message: z.string(),
  fix: z.string(),
});
export type DiagnoseProblem = z.infer<typeof diagnoseProblemSchema>;

export const diagnoseResultSchema = z.object({
  ok: z.boolean(),
  problems: z.array(diagnoseProblemSchema),
  stats: memoryStatsSchema,
});
export type DiagnoseResult = z.infer<typeof diagnoseResultSchema>;

export const healResultSchema = z.object({
  reindexed: z.number().int(),
  autoForget: z.object({
    expired: z.number().int(),
    stale: z.number().int(),
    deleted: z.number().int(),
  }),
});
export type HealResult = z.infer<typeof healResultSchema>;

// ---- 审计 ----

export const auditEntrySchema = z.object({
  id: z.string().uuid(),
  action: z.string(),
  detail: z.unknown().nullable(),
  createdAt: z.string(),
});
export type AuditEntryPublic = z.infer<typeof auditEntrySchema>;
