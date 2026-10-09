import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { ConsolidateResult, MemoryPublic, MemoryType, Origin, ShareInvitePublic, ShareResult } from '@agent-recall/dto';
import { recordAudit } from '../audit/log.js';
import { isUniqueViolation } from '../db/errors.js';
import { memories, shareInvites, users, type MemoryRow, type ShareInviteRow } from '../db/schema.js';
import { AppError } from '../errors.js';
import { createMemory, listMemories, type CreateMemoryResult, type MemoryDeps } from './service.js';
import { redactSecrets } from './privacy.js';
import { semanticConsolidate } from './semantic.js';

async function removeFromIndexes(deps: MemoryDeps, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    await deps.retrieval.meili.deleteDocuments(deps.retrieval.meiliIndex, ids);
    await deps.retrieval.qdrant.deletePoints(deps.retrieval.qdrantCollection, ids);
  } catch {
    // 主行操作已完成，索引残留由后续治理收敛
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function findInviteByParties(
  deps: MemoryDeps,
  fromUserId: string,
  memoryId: string,
  toUserId: string,
): Promise<ShareInviteRow | undefined> {
  const rows = await deps.db
    .select()
    .from(shareInvites)
    .where(
      and(
        eq(shareInvites.fromUserId, fromUserId),
        eq(shareInvites.memoryId, memoryId),
        eq(shareInvites.toUserId, toUserId),
      ),
    );
  return rows[0];
}

async function findInvite(deps: MemoryDeps, id: string): Promise<ShareInviteRow | undefined> {
  const rows = await deps.db.select().from(shareInvites).where(eq(shareInvites.id, id));
  return rows[0];
}

function requireRecipient(invite: ShareInviteRow | undefined, userId: string): ShareInviteRow {
  if (!invite || invite.toUserId !== userId) throw new AppError(404, 'NOT_FOUND', '邀请不存在');
  return invite;
}

/** 接受时复制：隐私清洗，保留 origin/type/project/sessionId，加 shared，eventId 幂等 */
async function copySharedMemory(deps: MemoryDeps, targetUserId: string, row: MemoryRow): Promise<CreateMemoryResult> {
  const { content } = redactSecrets(row.content);
  return createMemory(deps, targetUserId, {
    content,
    origin: row.origin as Origin,
    type: row.type as MemoryType,
    tags: [...new Set([...row.tags, 'shared'])],
    project: row.project ?? undefined,
    sessionId: row.sessionId ?? undefined,
    eventId: `share:${row.id}:${targetUserId}`,
    skipDedup: true,
  });
}

/** 已接受保持 accepted；待处理保持 pending；已拒绝则重开并记 share_invite */
async function reopenOrKeep(
  deps: MemoryDeps,
  fromUserId: string,
  memoryId: string,
  toUserId: string,
  invite: ShareInviteRow,
): Promise<'pending' | 'accepted'> {
  if (invite.status === 'accepted') return 'accepted';
  if (invite.status === 'pending') return 'pending';
  const updated = await deps.db
    .update(shareInvites)
    .set({ status: 'pending', updatedAt: new Date() })
    .where(and(eq(shareInvites.id, invite.id), eq(shareInvites.status, 'rejected')))
    .returning({ id: shareInvites.id });
  if (updated.length > 0) {
    await recordAudit(deps.db, fromUserId, 'memory.share_invite', { memoryId, to: toUserId });
    return 'pending';
  }
  const again = await findInviteByParties(deps, fromUserId, memoryId, toUserId);
  if (again?.status === 'accepted') return 'accepted';
  return 'pending';
}

async function createInvite(
  deps: MemoryDeps,
  fromUserId: string,
  memoryId: string,
  toUserId: string,
): Promise<'pending' | 'accepted'> {
  const now = new Date();
  try {
    await deps.db.insert(shareInvites).values({
      id: randomUUID(),
      fromUserId,
      toUserId,
      memoryId,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const existing = await findInviteByParties(deps, fromUserId, memoryId, toUserId);
    if (!existing) throw err;
    return reopenOrKeep(deps, fromUserId, memoryId, toUserId, existing);
  }
  await recordAudit(deps.db, fromUserId, 'memory.share_invite', { memoryId, to: toUserId });
  return 'pending';
}

/**
 * 团队共享：只创建或重开邀请，接受前不复制。
 * 未知邮箱和分享给自己与新建邀请返回相同的 pending，且不插入行。
 */
export async function shareMemory(deps: MemoryDeps, userId: string, id: string, email: string): Promise<ShareResult> {
  const source = await deps.db
    .select()
    .from(memories)
    .where(and(eq(memories.id, id), eq(memories.userId, userId)));
  const row = source[0];
  if (!row) throw new AppError(404, 'NOT_FOUND', '记忆不存在');

  const targets = await deps.db.select().from(users).where(eq(users.email, normalizeEmail(email)));
  const target = targets[0];
  if (!target || target.id === userId) return { shared: true, delivery: 'pending' };

  const existing = await findInviteByParties(deps, userId, row.id, target.id);
  const delivery = existing
    ? await reopenOrKeep(deps, userId, row.id, target.id, existing)
    : await createInvite(deps, userId, row.id, target.id);
  return { shared: true, delivery };
}

/** 当前用户收到的待处理邀请。正文读活的源记忆并先做隐私清洗；源记忆已删除的邀请不返回。 */
export async function listIncomingShares(deps: MemoryDeps, userId: string): Promise<ShareInvitePublic[]> {
  const rows = await deps.db
    .select({
      id: shareInvites.id,
      fromEmail: users.email,
      fromDisplayName: users.displayName,
      memoryId: shareInvites.memoryId,
      content: memories.content,
      project: memories.project,
      createdAt: shareInvites.createdAt,
    })
    .from(shareInvites)
    .innerJoin(memories, eq(memories.id, shareInvites.memoryId))
    .innerJoin(users, eq(users.id, shareInvites.fromUserId))
    .where(and(eq(shareInvites.toUserId, userId), eq(shareInvites.status, 'pending')))
    .orderBy(desc(shareInvites.createdAt));
  return rows.map((row) => ({
    id: row.id,
    fromEmail: row.fromEmail,
    fromDisplayName: row.fromDisplayName,
    memoryId: row.memoryId,
    content: redactSecrets(row.content).content,
    project: row.project,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function acceptShare(
  deps: MemoryDeps,
  userId: string,
  inviteId: string,
): Promise<{ memory: MemoryPublic; delivery: 'accepted' }> {
  const invite = requireRecipient(await findInvite(deps, inviteId), userId);
  if (invite.status === 'rejected') throw new AppError(409, 'CONFLICT', '邀请已拒绝');
  const sourceRows = await deps.db.select().from(memories).where(eq(memories.id, invite.memoryId));
  const source = sourceRows[0];
  if (!source) throw new AppError(404, 'NOT_FOUND', '邀请不存在');
  const copied = await copySharedMemory(deps, userId, source);
  if (invite.status === 'pending') {
    const updated = await deps.db
      .update(shareInvites)
      .set({ status: 'accepted', updatedAt: new Date() })
      .where(and(eq(shareInvites.id, invite.id), eq(shareInvites.status, 'pending')))
      .returning({ id: shareInvites.id });
    if (updated.length > 0) {
      await recordAudit(deps.db, invite.fromUserId, 'memory.share', { memoryId: source.id, to: userId });
    }
  }
  return { memory: copied.memory, delivery: 'accepted' };
}

export async function rejectShare(
  deps: MemoryDeps,
  userId: string,
  inviteId: string,
): Promise<{ delivery: 'rejected' }> {
  const invite = requireRecipient(await findInvite(deps, inviteId), userId);
  if (invite.status === 'accepted') throw new AppError(409, 'CONFLICT', '邀请已接受');
  if (invite.status === 'pending') {
    await deps.db
      .update(shareInvites)
      .set({ status: 'rejected', updatedAt: new Date() })
      .where(and(eq(shareInvites.id, invite.id), eq(shareInvites.status, 'pending')));
  }
  return { delivery: 'rejected' };
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
  const semantic = await semanticConsolidate(deps, userId, dryRun);
  return { groups: groups.length, merged, semantic };
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
