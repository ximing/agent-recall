import { createHash, randomUUID } from 'node:crypto';
import type { MemoryFilter, MemoryPublic, MemoryType, Origin } from '@agent-recall/dto';
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { memories, type MemoryRow } from '../db/schema.js';
import { isUniqueViolation } from '../db/errors.js';
import { AppError } from '../errors.js';
import { recordAudit } from '../audit/log.js';
import type { RetrievalPorts } from '../retrieval/ports.js';
import { indexMemory, recallMemories, type Reranker } from '../retrieval/recall.js';
import { createRerankClient } from '../retrieval/rerank.js';
import { getRerankApiKey, getSettings } from '../settings/service.js';
import type { UserSettingsRow } from '../db/schema.js';
import { recordRecallLog } from './recall-log.js';

export interface MemoryDeps {
  db: Database;
  retrieval: RetrievalPorts;
  /** 敏感设置加解密密钥所在数据目录 */
  dataDir: string;
}

/** 内容哈希去重窗口：同一用户 5 分钟内写入相同规范化内容视为重复 */
export const DEDUP_WINDOW_MS = 5 * 60 * 1000;

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function toMemory(row: MemoryRow): MemoryPublic {
  return {
    id: row.id,
    content: row.content,
    origin: row.origin as Origin,
    type: row.type as MemoryType,
    tags: row.tags,
    project: row.project,
    sessionId: row.sessionId,
    eventId: row.eventId,
    expiresAt: row.expiresAt ? iso(row.expiresAt) : null,
    version: row.version,
    chainId: row.chainId,
    parentId: row.parentId,
    isLatest: row.isLatest,
    accessCount: row.accessCount,
    lastAccessedAt: row.lastAccessedAt ? iso(row.lastAccessedAt) : null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function hashContent(content: string): string {
  const normalized = content.trim().replace(/\s+/g, ' ').toLowerCase();
  return createHash('sha256').update(normalized).digest('hex');
}

async function tryIndex(deps: MemoryDeps, row: MemoryRow): Promise<void> {
  try {
    await indexMemory(deps.retrieval, row);
    await deps.db.update(memories).set({ indexedAt: new Date() }).where(eq(memories.id, row.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`index memory ${row.id} failed: ${message}`);
  }
}

async function removeFromIndexes(deps: MemoryDeps, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    await deps.retrieval.meili.deleteDocuments(deps.retrieval.meiliIndex, ids);
    await deps.retrieval.qdrant.deletePoints(deps.retrieval.qdrantCollection, ids);
  } catch {
    // 主行操作已完成，索引残留由后续 reindex/治理收敛
  }
}

export interface CreateMemoryInput {
  content: string;
  origin: Origin;
  type?: MemoryType;
  tags?: string[];
  project?: string;
  sessionId?: string;
  eventId?: string;
  expiresAt?: Date;
  /** 跳过内容哈希窗口去重（如导入场景） */
  skipDedup?: boolean;
}

export interface CreateMemoryResult {
  memory: MemoryPublic;
  /** true = 命中 eventId 幂等或内容哈希窗口去重，返回的是已有记忆 */
  deduped: boolean;
}

async function findByEventId(deps: MemoryDeps, userId: string, eventId: string): Promise<MemoryRow | undefined> {
  const rows = await deps.db
    .select()
    .from(memories)
    .where(and(eq(memories.userId, userId), eq(memories.eventId, eventId)));
  return rows[0];
}

async function findRecentDuplicate(deps: MemoryDeps, userId: string, contentHash: string): Promise<MemoryRow | undefined> {
  const since = new Date(Date.now() - DEDUP_WINDOW_MS);
  const rows = await deps.db
    .select()
    .from(memories)
    .where(
      and(
        eq(memories.userId, userId),
        eq(memories.contentHash, contentHash),
        eq(memories.isLatest, true),
        gte(memories.createdAt, since),
      ),
    )
    .orderBy(desc(memories.createdAt))
    .limit(1);
  return rows[0];
}

export async function createMemory(
  deps: MemoryDeps,
  userId: string,
  input: CreateMemoryInput,
): Promise<CreateMemoryResult> {
  if (input.eventId) {
    const prior = await findByEventId(deps, userId, input.eventId);
    if (prior) return { memory: toMemory(prior), deduped: true };
  }
  const contentHash = hashContent(input.content);
  if (!input.skipDedup) {
    const dup = await findRecentDuplicate(deps, userId, contentHash);
    if (dup) return { memory: toMemory(dup), deduped: true };
  }

  const now = new Date();
  const id = randomUUID();
  const values = {
    id,
    userId,
    content: input.content,
    origin: input.origin,
    type: input.type ?? 'fact',
    tags: input.tags ?? [],
    project: input.project ?? null,
    sessionId: input.sessionId ?? null,
    eventId: input.eventId ?? null,
    contentHash,
    expiresAt: input.expiresAt ?? null,
    chainId: id,
    parentId: null,
    version: 1,
    isLatest: true,
    accessCount: 0,
    lastAccessedAt: null,
    indexedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  try {
    const inserted = await deps.db.insert(memories).values(values).returning();
    const row = inserted[0];
    if (!row) throw new AppError(500, 'INTERNAL', '写入记忆失败');
    await tryIndex(deps, row);
    return { memory: toMemory(row), deduped: false };
  } catch (err) {
    if (input.eventId && isUniqueViolation(err)) {
      const prior = await findByEventId(deps, userId, input.eventId);
      if (prior) return { memory: toMemory(prior), deduped: true };
    }
    throw err;
  }
}

/** 组装 SQL 过滤条件（版本链默认只看最新版，过期默认排除） */
export function buildFilterConditions(userId: string, filter?: MemoryFilter): SQL[] {
  const conditions: SQL[] = [eq(memories.userId, userId), eq(memories.isLatest, true)];
  if (!filter?.includeExpired) {
    conditions.push(or(isNull(memories.expiresAt), gte(memories.expiresAt, new Date()))!);
  }
  if (filter?.origin?.length) conditions.push(inArray(memories.origin, filter.origin));
  if (filter?.type?.length) conditions.push(inArray(memories.type, filter.type));
  if (filter?.project) conditions.push(eq(memories.project, filter.project));
  if (filter?.sessionId) conditions.push(eq(memories.sessionId, filter.sessionId));
  if (filter?.createdAfter) conditions.push(gte(memories.createdAt, new Date(filter.createdAfter)));
  if (filter?.createdBefore) conditions.push(lt(memories.createdAt, new Date(filter.createdBefore)));
  if (filter?.tags?.length) {
    const values = filter.tags.map((tag) => tag.replace(/'/g, "''"));
    conditions.push(sql`${memories.tags} ?| array[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]`);
  }
  return conditions;
}

export interface ListOptions {
  filter?: MemoryFilter;
  limit?: number;
  offset?: number;
}

export async function listMemories(deps: MemoryDeps, userId: string, options: ListOptions = {}): Promise<MemoryPublic[]> {
  const rows = await deps.db
    .select()
    .from(memories)
    .where(and(...buildFilterConditions(userId, options.filter)))
    .orderBy(desc(memories.createdAt))
    .limit(options.limit ?? 500)
    .offset(options.offset ?? 0);
  return rows.map(toMemory);
}

export async function getMemory(deps: MemoryDeps, userId: string, id: string): Promise<MemoryPublic> {
  const rows = await deps.db
    .select()
    .from(memories)
    .where(and(eq(memories.id, id), eq(memories.userId, userId)));
  const row = rows[0];
  if (!row) throw new AppError(404, 'NOT_FOUND', '记忆不存在');
  return toMemory(row);
}

/** 版本链：整条链按 version 升序 */
export async function getMemoryVersions(deps: MemoryDeps, userId: string, id: string): Promise<MemoryPublic[]> {
  const target = await deps.db
    .select()
    .from(memories)
    .where(and(eq(memories.id, id), eq(memories.userId, userId)));
  const row = target[0];
  if (!row) throw new AppError(404, 'NOT_FOUND', '记忆不存在');
  const chain = await deps.db
    .select()
    .from(memories)
    .where(and(eq(memories.userId, userId), eq(memories.chainId, row.chainId)))
    .orderBy(memories.version);
  return chain.map(toMemory);
}

export interface UpdateMemoryInput {
  content: string;
  type?: MemoryType;
  tags?: string[];
  expiresAt?: Date | null;
}

/**
 * 编辑 = 创建新版本：旧版本 isLatest=false 并退出检索索引，
 * 新版本继承 chainId，version+1。历史版本保留可回溯。
 */
export async function updateMemory(
  deps: MemoryDeps,
  userId: string,
  id: string,
  input: UpdateMemoryInput,
): Promise<MemoryPublic> {
  const existing = await deps.db
    .select()
    .from(memories)
    .where(and(eq(memories.id, id), eq(memories.userId, userId)));
  const prev = existing[0];
  if (!prev) throw new AppError(404, 'NOT_FOUND', '记忆不存在');

  const now = new Date();
  const nextId = randomUUID();
  await deps.db.update(memories).set({ isLatest: false, updatedAt: now }).where(eq(memories.id, prev.id));
  const inserted = await deps.db
    .insert(memories)
    .values({
      id: nextId,
      userId,
      content: input.content,
      origin: prev.origin,
      type: input.type ?? (prev.type as MemoryType),
      tags: input.tags ?? prev.tags,
      project: prev.project,
      sessionId: prev.sessionId,
      eventId: null,
      contentHash: hashContent(input.content),
      expiresAt: input.expiresAt === undefined ? prev.expiresAt : input.expiresAt,
      chainId: prev.chainId,
      parentId: prev.id,
      version: prev.version + 1,
      isLatest: true,
      accessCount: prev.accessCount,
      lastAccessedAt: prev.lastAccessedAt,
      indexedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const next = inserted[0];
  if (!next) throw new AppError(500, 'INTERNAL', '更新记忆失败');
  await removeFromIndexes(deps, [prev.id]);
  await tryIndex(deps, next);
  return toMemory(next);
}

/** 删除整条版本链（含历史版本），并清理检索索引 */
export async function deleteMemory(deps: MemoryDeps, userId: string, id: string): Promise<void> {
  const existing = await deps.db
    .select()
    .from(memories)
    .where(and(eq(memories.id, id), eq(memories.userId, userId)));
  const row = existing[0];
  if (!row) throw new AppError(404, 'NOT_FOUND', '记忆不存在');
  const chain = await deps.db
    .select({ id: memories.id })
    .from(memories)
    .where(and(eq(memories.userId, userId), eq(memories.chainId, row.chainId)));
  const ids = chain.map((r) => r.id);
  await deps.db.delete(memories).where(inArray(memories.id, ids));
  await removeFromIndexes(deps, ids);
  await recordAudit(deps.db, userId, 'memory.delete', { id, chainId: row.chainId, versions: ids.length });
}

/** 召回命中反馈：更新 accessCount / lastAccessedAt，供衰减与治理使用 */
export async function markAccessed(deps: MemoryDeps, userId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    await deps.db
      .update(memories)
      .set({
        accessCount: sql`${memories.accessCount} + 1`,
        lastAccessedAt: new Date(),
      })
      .where(and(eq(memories.userId, userId), inArray(memories.id, ids)));
  } catch {
    // 命中反馈失败不影响召回主链路
  }
}

function buildReranker(settings: UserSettingsRow, dataDir: string): Reranker | undefined {
  const apiKey = getRerankApiKey(settings, dataDir);
  if (!settings.rerankEnabled || !apiKey) return undefined;
  const client = createRerankClient({
    apiKey,
    baseUrl: settings.rerankBaseUrl,
    model: settings.rerankModel,
  });
  return {
    async rerank(query, docs) {
      const results = await client.rerankTexts(
        query,
        docs.map((doc) => doc.text),
        docs.length,
      );
      return results.flatMap((result) => {
        const doc = docs[result.index];
        return doc ? [{ id: doc.id, score: result.score }] : [];
      });
    },
  };
}

export interface RecallResult {
  memories: MemoryPublic[];
  scores: Record<string, number | null>;
  strategy: 'rrf' | 'rrf+rerank';
}

export async function recallForUser(
  deps: MemoryDeps,
  userId: string,
  query: string,
  limit: number,
  options: { filter?: MemoryFilter; deep?: boolean } = {},
): Promise<RecallResult> {
  const settings = await getSettings(deps.db, userId);
  const reranker = buildReranker(settings, deps.dataDir);
  const started = performance.now();
  const outcome = await recallMemories(deps.db, deps.retrieval, userId, query, limit, {
    reranker,
    filter: options.filter,
    deep: options.deep,
  });
  const latencyMs = Math.round(performance.now() - started);
  const scores: Record<string, number | null> = {};
  for (const row of outcome.rows) scores[row.id] = outcome.rerankScores[row.id] ?? null;
  await recordRecallLog(deps.db, {
    userId,
    query,
    strategy: reranker ? 'rrf+rerank' : 'rrf',
    rerankModel: reranker ? settings.rerankModel : null,
    rerankApplied: outcome.rerankApplied,
    rerankError: outcome.rerankError,
    results: outcome.rows.map((row) => ({ id: row.id, content: row.content, score: scores[row.id] ?? null })),
    latencyMs,
  });
  const memories_ = outcome.rows.map(toMemory);
  void markAccessed(deps, userId, memories_.map((m) => m.id));
  return { memories: memories_, scores, strategy: reranker ? 'rrf+rerank' : 'rrf' };
}
