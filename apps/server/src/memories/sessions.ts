import type { MemoryPublic, SessionSummaryPublic } from '@agent-recall/dto';
import { and, asc, count, eq, isNotNull, max, min, sql } from 'drizzle-orm';
import { memories } from '../db/schema.js';
import { createMemory, toMemory, type CreateMemoryResult, type MemoryDeps } from './service.js';

/** 会话列表：按 sessionId 聚合（hook 事件与摘要都属于会话） */
export async function listSessions(deps: MemoryDeps, userId: string): Promise<SessionSummaryPublic[]> {
  const rows = await deps.db
    .select({
      sessionId: memories.sessionId,
      memoryCount: count(),
      firstAt: min(memories.createdAt),
      lastAt: max(memories.createdAt),
      projects: sql<string[]>`array_agg(distinct ${memories.project}) filter (where ${memories.project} is not null)`,
    })
    .from(memories)
    .where(and(eq(memories.userId, userId), isNotNull(memories.sessionId)))
    .groupBy(memories.sessionId)
    .orderBy(sql`max(${memories.createdAt}) desc`)
    .limit(200);
  return rows.flatMap((row) => {
    if (!row.sessionId || !row.firstAt || !row.lastAt) return [];
    return [
      {
        sessionId: row.sessionId,
        memoryCount: row.memoryCount,
        firstAt: row.firstAt.toISOString(),
        lastAt: row.lastAt.toISOString(),
        projects: row.projects ?? [],
      },
    ];
  });
}

export async function sessionTimeline(deps: MemoryDeps, userId: string, sessionId: string): Promise<MemoryPublic[]> {
  const rows = await deps.db
    .select()
    .from(memories)
    .where(and(eq(memories.userId, userId), eq(memories.sessionId, sessionId), eq(memories.isLatest, true)))
    .orderBy(asc(memories.createdAt))
    .limit(500);
  return rows.map(toMemory);
}

/**
 * SessionEnd 摘要（抽取式，无 LLM 依赖）：
 * 汇总该会话的 hook 观察，去重、取每条的要点行，生成一条 origin=summary 的长期记忆。
 * eventId 默认 `${sessionId}:session-summary`（重复触发幂等）；
 * 手动结晶（crystallize）传入 `crystal:` 前缀的 eventId 允许按小时多次结晶。
 */
export async function createSessionSummary(
  deps: MemoryDeps,
  userId: string,
  sessionId: string,
  project?: string,
  eventId?: string,
): Promise<CreateMemoryResult> {
  const dedupeId = eventId ?? `${sessionId}:session-summary`;
  const rows = await deps.db
    .select()
    .from(memories)
    .where(
      and(
        eq(memories.userId, userId),
        eq(memories.sessionId, sessionId),
        eq(memories.origin, 'hook'),
        eq(memories.isLatest, true),
      ),
    )
    .orderBy(asc(memories.createdAt))
    .limit(500);
  if (rows.length === 0) {
    return createMemory(deps, userId, {
      content: `会话 ${sessionId} 结束，无可摘要的观察。`,
      origin: 'summary',
      sessionId,
      project,
      eventId: dedupeId,
    });
  }

  const seen = new Set<string>();
  const highlights: string[] = [];
  for (const row of rows) {
    const firstLine = row.content.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
    const key = firstLine.slice(0, 120);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (highlights.length < 20) highlights.push(`- ${key.slice(0, 200)}`);
  }
  const first = rows[0]!.createdAt;
  const last = rows[rows.length - 1]!.createdAt;
  const content = [
    `## 会话摘要`,
    ``,
    `- 会话：${sessionId}`,
    project ? `- 项目：${project}` : null,
    `- 观察数：${rows.length}，时间范围：${first.toISOString()} ~ ${last.toISOString()}`,
    ``,
    `### 要点`,
    ...highlights,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  return createMemory(deps, userId, {
    content,
    origin: 'summary',
    type: 'workflow',
    sessionId,
    project,
    eventId: dedupeId,
  });
}
