import { randomUUID } from 'node:crypto';
import type { ExportResult, ImportStrategy, MemoryFilter, MemoryStats } from '@agent-recall/dto';
import { and, count, eq, gte, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { recordAudit } from '../audit/log.js';
import { memories, type MemoryRow } from '../db/schema.js';
import { indexMemory } from '../retrieval/recall.js';
import { getSettings } from '../settings/service.js';
import { buildFilterConditions, hashContent, toMemory, type MemoryDeps } from './service.js';

async function removeFromIndexes(deps: MemoryDeps, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    await deps.retrieval.meili.deleteDocuments(deps.retrieval.meiliIndex, ids);
    await deps.retrieval.qdrant.deletePoints(deps.retrieval.qdrantCollection, ids);
  } catch {
    // 主行已删，索引残留由后续收敛
  }
}

/** 批量删除：按显式 ids 或过滤器。删除记忆会带走整条版本链。 */
export async function batchForget(
  deps: MemoryDeps,
  userId: string,
  input: { ids?: string[]; filter?: MemoryFilter; dryRun?: boolean },
): Promise<{ matched: number; deleted: number }> {
  let targets: Array<{ id: string; chainId: string }> = [];
  if (input.ids?.length) {
    targets = await deps.db
      .select({ id: memories.id, chainId: memories.chainId })
      .from(memories)
      .where(and(eq(memories.userId, userId), inArray(memories.id, input.ids)));
  } else if (input.filter) {
    targets = await deps.db
      .select({ id: memories.id, chainId: memories.chainId })
      .from(memories)
      .where(and(...buildFilterConditions(userId, input.filter)));
  }
  // 版本链去重：一条链只删一次
  const chainIds = [...new Set(targets.map((t) => t.chainId))];
  if (input.dryRun || chainIds.length === 0) {
    return { matched: chainIds.length, deleted: 0 };
  }
  const allVersions = await deps.db
    .select({ id: memories.id })
    .from(memories)
    .where(and(eq(memories.userId, userId), inArray(memories.chainId, chainIds)));
  const allIds = allVersions.map((r) => r.id);
  await deps.db.delete(memories).where(and(eq(memories.userId, userId), inArray(memories.chainId, chainIds)));
  await removeFromIndexes(deps, allIds);
  await recordAudit(deps.db, userId, 'memory.batch_forget', { matched: chainIds.length, deleted: chainIds.length });
  return { matched: chainIds.length, deleted: chainIds.length };
}

/**
 * 自动遗忘（P3）：
 * 1. 过期记忆（expiresAt < now）
 * 2. 低价值 hook 碎片：origin=hook、从未被召回命中、超过 autoForgetDays 天
 */
export async function autoForget(
  deps: MemoryDeps,
  userId: string,
  dryRun: boolean,
): Promise<{ expired: number; stale: number; deleted: number }> {
  const settings = await getSettings(deps.db, userId);
  const now = new Date();

  const expiredRows = await deps.db
    .select({ chainId: memories.chainId })
    .from(memories)
    .where(and(eq(memories.userId, userId), isNotNull(memories.expiresAt), lt(memories.expiresAt, now)));
  const expiredChains = new Set(expiredRows.map((r) => r.chainId));

  let staleChains = new Set<string>();
  if (settings.autoForgetDays > 0) {
    const cutoff = new Date(now.getTime() - settings.autoForgetDays * 24 * 60 * 60 * 1000);
    const staleRows = await deps.db
      .select({ chainId: memories.chainId })
      .from(memories)
      .where(
        and(
          eq(memories.userId, userId),
          eq(memories.origin, 'hook'),
          eq(memories.accessCount, 0),
          lt(memories.createdAt, cutoff),
        ),
      );
    staleChains = new Set(staleRows.map((r) => r.chainId));
  }

  const allChains = [...new Set([...expiredChains, ...staleChains])];
  if (dryRun || allChains.length === 0) {
    return { expired: expiredChains.size, stale: staleChains.size, deleted: 0 };
  }
  const allVersions = await deps.db
    .select({ id: memories.id })
    .from(memories)
    .where(and(eq(memories.userId, userId), inArray(memories.chainId, allChains)));
  await deps.db.delete(memories).where(and(eq(memories.userId, userId), inArray(memories.chainId, allChains)));
  await removeFromIndexes(deps, allVersions.map((r) => r.id));
  await recordAudit(deps.db, userId, 'memory.auto_forget', {
    expired: expiredChains.size,
    stale: staleChains.size,
    deleted: allChains.length,
  });
  return { expired: expiredChains.size, stale: staleChains.size, deleted: allChains.length };
}

export async function memoryStats(deps: MemoryDeps, userId: string): Promise<MemoryStats> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const live = and(eq(memories.userId, userId), eq(memories.isLatest, true));

  const [total] = await deps.db.select({ n: count() }).from(memories).where(live);
  const byOriginRows = await deps.db
    .select({ key: memories.origin, n: count() })
    .from(memories)
    .where(live)
    .groupBy(memories.origin);
  const byTypeRows = await deps.db
    .select({ key: memories.type, n: count() })
    .from(memories)
    .where(live)
    .groupBy(memories.type);
  const [expired] = await deps.db
    .select({ n: count() })
    .from(memories)
    .where(and(live, isNotNull(memories.expiresAt), lt(memories.expiresAt, now)));
  const [pending] = await deps.db
    .select({ n: count() })
    .from(memories)
    .where(and(live, isNull(memories.indexedAt)));
  const [recent] = await deps.db
    .select({ n: count() })
    .from(memories)
    .where(and(eq(memories.userId, userId), gte(memories.createdAt, weekAgo)));
  const [sessionCount] = await deps.db
    .select({ n: sql<number>`count(distinct ${memories.sessionId})` })
    .from(memories)
    .where(and(eq(memories.userId, userId), isNotNull(memories.sessionId)));

  return {
    total: total?.n ?? 0,
    byOrigin: Object.fromEntries(byOriginRows.map((r) => [r.key, r.n])),
    byType: Object.fromEntries(byTypeRows.map((r) => [r.key, r.n])),
    expired: expired?.n ?? 0,
    pendingIndex: pending?.n ?? 0,
    createdLast7d: recent?.n ?? 0,
    sessions: Number(sessionCount?.n ?? 0),
  };
}

export async function exportMemories(deps: MemoryDeps, userId: string): Promise<ExportResult> {
  const rows = await deps.db
    .select()
    .from(memories)
    .where(eq(memories.userId, userId))
    .orderBy(memories.createdAt);
  return {
    format: 'agent-recall/v1',
    exportedAt: new Date().toISOString(),
    memories: rows.map(toMemory),
  };
}

/**
 * 导入：skip/merge = 已存在的 id 跳过；replace = 覆盖同 id 行并重建索引。
 * 缺 id/chainId 的行分配新 id。导入行不参与窗口去重。
 */
export interface ImportMemoryItem {
  id?: string;
  content: string;
  origin?: string;
  type?: string;
  tags?: string[];
  project?: string | null;
  sessionId?: string | null;
  expiresAt?: string | null;
  chainId?: string;
  parentId?: string | null;
  version?: number;
  isLatest?: boolean;
  accessCount?: number;
  lastAccessedAt?: string | null;
  createdAt?: string;
}

export async function importMemories(
  deps: MemoryDeps,
  userId: string,
  input: { memories: ImportMemoryItem[]; strategy?: ImportStrategy },
): Promise<{ imported: number; skipped: number; replaced: number }> {
  const strategy = input.strategy ?? 'skip';
  let imported = 0;
  let skipped = 0;
  let replaced = 0;

  for (const item of input.memories) {
    const now = new Date();
    const id = item.id ?? randomUUID();
    const existing = await deps.db
      .select()
      .from(memories)
      .where(and(eq(memories.id, id), eq(memories.userId, userId)));
    const prior = existing[0];
    if (prior && strategy !== 'replace') {
      skipped += 1;
      continue;
    }
    if (prior) {
      await deps.db.delete(memories).where(eq(memories.id, prior.id));
      await removeFromIndexes(deps, [prior.id]);
      replaced += 1;
    } else {
      imported += 1;
    }
    const row: typeof memories.$inferInsert = {
      id,
      userId,
      content: item.content,
      origin: item.origin ?? 'import',
      type: item.type ?? 'fact',
      tags: item.tags ?? [],
      project: item.project ?? null,
      sessionId: item.sessionId ?? null,
      eventId: null,
      contentHash: hashContent(item.content),
      expiresAt: item.expiresAt ? new Date(item.expiresAt) : null,
      chainId: item.chainId ?? id,
      parentId: item.parentId ?? null,
      version: item.version ?? 1,
      isLatest: item.isLatest ?? true,
      accessCount: item.accessCount ?? 0,
      lastAccessedAt: item.lastAccessedAt ? new Date(item.lastAccessedAt) : null,
      indexedAt: null,
      createdAt: item.createdAt ? new Date(item.createdAt) : now,
      updatedAt: now,
    };
    const inserted = await deps.db.insert(memories).values(row).returning();
    const insertedRow = inserted[0];
    if (insertedRow?.isLatest) {
      try {
        await indexMemory(deps.retrieval, insertedRow);
        await deps.db.update(memories).set({ indexedAt: new Date() }).where(eq(memories.id, insertedRow.id));
      } catch (err) {
        console.error(`index imported memory ${insertedRow.id} failed:`, err);
      }
    }
  }
  await recordAudit(deps.db, userId, 'memory.import', { strategy, imported, skipped, replaced });
  return { imported, skipped, replaced };
}
