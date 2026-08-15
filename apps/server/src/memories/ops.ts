import { and, desc, eq, gte, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { ConsolidateResult, MemoryPublic, MemoryType, Origin } from '@agent-recall/dto';
import { recordAudit } from '../audit/log.js';
import { memories, users } from '../db/schema.js';
import { AppError } from '../errors.js';
import { createMemory, listMemories, type CreateMemoryResult, type MemoryDeps } from './service.js';
import { redactSecrets } from './privacy.js';

async function removeFromIndexes(deps: MemoryDeps, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    await deps.retrieval.meili.deleteDocuments(deps.retrieval.meiliIndex, ids);
    await deps.retrieval.qdrant.deletePoints(deps.retrieval.qdrantCollection, ids);
  } catch {
    // 主行操作已完成，索引残留由后续治理收敛
  }
}

/** 团队共享：隐私清洗后把记忆复制到目标用户库，eventId 幂等 */
export async function shareMemory(deps: MemoryDeps, userId: string, id: string, email: string): Promise<void> {
  const source = await deps.db
    .select()
    .from(memories)
    .where(and(eq(memories.id, id), eq(memories.userId, userId)));
  const row = source[0];
  if (!row) throw new AppError(404, 'NOT_FOUND', '记忆不存在');

  const targets = await deps.db.select().from(users).where(eq(users.email, email));
  const target = targets[0];
  if (!target) throw new AppError(404, 'NOT_FOUND', '目标用户不存在');

  const { content } = redactSecrets(row.content);
  await createMemory(deps, target.id, {
    content,
    origin: row.origin as Origin,
    type: row.type as MemoryType,
    tags: [...new Set([...row.tags, 'shared'])],
    project: row.project ?? undefined,
    sessionId: row.sessionId ?? undefined,
    eventId: `share:${row.id}:${target.id}`,
    skipDedup: true,
  });
  await recordAudit(deps.db, userId, 'memory.share', { memoryId: row.id, to: target.id });
}

/** 共享订阅：当前用户 tags 含 'shared' 的最新版记忆 */
export async function sharedFeed(deps: MemoryDeps, userId: string): Promise<MemoryPublic[]> {
  return listMemories(deps, userId, { filter: { tags: ['shared'] } });
}

/**
 * 近重复合并：同一 contentHash 下存在多条 isLatest 链时，
 * 保留 createdAt 最新的链，其余链删除并清索引。
 */
export async function consolidateMemories(deps: MemoryDeps, userId: string, dryRun: boolean): Promise<ConsolidateResult> {
  const groups = await deps.db
    .select({
      contentHash: memories.contentHash,
      chains: sql<number>`count(distinct ${memories.chainId})`,
    })
    .from(memories)
    .where(and(eq(memories.userId, userId), eq(memories.isLatest, true), isNotNull(memories.contentHash)))
    .groupBy(memories.contentHash)
    .having(sql`count(distinct ${memories.chainId}) > 1`);

  let merged = 0;
  for (const group of groups) {
    if (!group.contentHash) continue;
    const rows = await deps.db
      .select({ chainId: memories.chainId, createdAt: memories.createdAt })
      .from(memories)
      .where(
        and(
          eq(memories.userId, userId),
          eq(memories.isLatest, true),
          eq(memories.contentHash, group.contentHash),
        ),
      )
      .orderBy(desc(memories.createdAt));
    const keep = rows[0]?.chainId;
    const dropChains = rows.map((r) => r.chainId).filter((chainId) => chainId !== keep);
    if (dropChains.length === 0) continue;
    merged += dropChains.length;
    if (dryRun) continue;
    const versions = await deps.db
      .select({ id: memories.id })
      .from(memories)
      .where(and(eq(memories.userId, userId), inArray(memories.chainId, dropChains)));
    await deps.db.delete(memories).where(and(eq(memories.userId, userId), inArray(memories.chainId, dropChains)));
    await removeFromIndexes(deps, versions.map((v) => v.id));
  }
  return { groups: groups.length, merged };
}

/**
 * 反思（抽取式，无 LLM）：汇总近 N 天 lesson/pattern/bug 记忆，
 * 生成一条 type=pattern 的当日幂等记忆。
 */
export async function reflectMemories(
  deps: MemoryDeps,
  userId: string,
  input: { days?: number; project?: string },
): Promise<CreateMemoryResult> {
  const days = input.days ?? 7;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const conditions = [
    eq(memories.userId, userId),
    eq(memories.isLatest, true),
    inArray(memories.type, ['lesson', 'pattern', 'bug']),
    gte(memories.createdAt, since),
    or(isNull(memories.expiresAt), gte(memories.expiresAt, new Date())),
  ];
  if (input.project) conditions.push(eq(memories.project, input.project));
  const rows = await deps.db
    .select()
    .from(memories)
    .where(and(...conditions))
    .orderBy(desc(memories.createdAt))
    .limit(500);

  // 不反思反思本身
  const sources = rows.filter((row) => !row.eventId?.startsWith(`reflect:${userId}:`));

  const byType: Record<string, number> = {};
  const seen = new Set<string>();
  const highlights: string[] = [];
  for (const row of sources) {
    byType[row.type] = (byType[row.type] ?? 0) + 1;
    const firstLine = row.content.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
    const key = firstLine.slice(0, 120);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (highlights.length < 30) highlights.push(`- [${row.type}] ${key.slice(0, 200)}`);
  }

  const counts = Object.entries(byType)
    .map(([type, n]) => `${type}×${n}`)
    .join('，');
  const content = [
    `## 反思（近 ${days} 天）`,
    ``,
    input.project ? `- 项目：${input.project}` : null,
    `- 样本：${sources.length} 条（${counts || '无'}）`,
    ``,
    `### 要点`,
    ...(highlights.length > 0 ? highlights : ['- 该时间窗口内没有 lesson/pattern/bug 记忆']),
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  const day = new Date().toISOString().slice(0, 10);
  return createMemory(deps, userId, {
    content,
    origin: 'agent',
    type: 'pattern',
    project: input.project,
    eventId: `reflect:${userId}:${day}`,
    skipDedup: true,
  });
}
