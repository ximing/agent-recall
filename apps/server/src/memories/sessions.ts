import type { MemoryPublic, ProjectSummaryPublic, SessionSummaryPublic } from '@agent-recall/dto';
import { and, asc, count, eq, isNotNull, max, min, ne, sql, type SQL } from 'drizzle-orm';
import { memories } from '../db/schema.js';
import { createMemory, toMemory, type CreateMemoryResult, type MemoryDeps } from './service.js';

/** 包含匹配。转义 LIKE 通配符，避免输入里的 % 或 _ 匹配全部。 */
function containsPattern(raw: string | undefined): string | undefined {
  const q = raw?.trim().slice(0, 80);
  if (!q) return undefined;
  return `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** LIKE 转义字符用 E'\\'，固定为一个反斜杠，不随 standard_conforming_strings 变化。 */
function ilikeEscape(column: SQL, pattern: string): SQL {
  return sql`${column} ilike ${pattern} escape E'\\\\'`;
}

/**
 * 会话列表：按 sessionId 聚合（hook 事件与摘要都属于会话）。
 * query 按会话 ID 或项目名包含匹配，不传时返回最近 200 场。
 */
export async function listSessions(deps: MemoryDeps, userId: string, query?: string): Promise<SessionSummaryPublic[]> {
  const pattern = containsPattern(query);
  const grouped = deps.db
    .select({
      sessionId: memories.sessionId,
      memoryCount: count(),
      firstAt: min(memories.createdAt),
      lastAt: max(memories.createdAt),
      projects: sql<string[]>`array_agg(distinct ${memories.project}) filter (where ${memories.project} is not null)`,
    })
    .from(memories)
    .where(and(eq(memories.userId, userId), isNotNull(memories.sessionId)))
    .groupBy(memories.sessionId);
  const rows = await (pattern
    ? grouped.having(sql`${ilikeEscape(sql`${memories.sessionId}`, pattern)} or bool_or(${ilikeEscape(sql`${memories.project}`, pattern)})`)
    : grouped
  )
    .orderBy(sql`max(${memories.createdAt}) desc`)
    .limit(pattern ? 50 : 200);
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

/** 已有项目：最新版、非空项目名。query 按名称包含匹配，不传时按最近写入返回。 */
export async function listProjects(deps: MemoryDeps, userId: string, query?: string): Promise<ProjectSummaryPublic[]> {
  const pattern = containsPattern(query);
  const conditions = [
    eq(memories.userId, userId),
    eq(memories.isLatest, true),
    isNotNull(memories.project),
    ne(memories.project, ''),
  ];
  if (pattern) conditions.push(ilikeEscape(sql`${memories.project}`, pattern));
  const rows = await deps.db
    .select({
      project: memories.project,
      memoryCount: count(),
      lastAt: max(memories.createdAt),
    })
    .from(memories)
    .where(and(...conditions))
    .groupBy(memories.project)
    .orderBy(sql`max(${memories.createdAt}) desc`)
    .limit(pattern ? 50 : 200);
  return rows.flatMap((row) => {
    if (!row.project || !row.lastAt) return [];
    return [
      {
        project: row.project,
        memoryCount: Number(row.memoryCount),
        lastAt: row.lastAt.toISOString(),
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
