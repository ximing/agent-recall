import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { MemoryFilter, Origin } from '@agent-recall/dto';
import type { Database } from '../db/client.js';
import { memories, type MemoryRow } from '../db/schema.js';
import type { RetrievalPorts } from './ports.js';
import { MEMORY_INDEX_SETTINGS } from './meili.js';
import { publicRerankFailure } from './rerank.js';
import { rrfMerge } from './rrf.js';

/** Meilisearch 过滤值用双引号包裹，内部的反斜杠和引号要转义。 */
export function meiliQuoted(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function meiliUserFilter(userId: string, project?: string): string {
  const user = `user_id = ${meiliQuoted(userId)}`;
  if (!project) return user;
  return `${user} AND project = ${meiliQuoted(project)}`;
}

export function qdrantUserFilter(userId: string, project?: string): { must: Array<{ key: string; match: { value: string } }> } {
  const must = [{ key: 'user_id', match: { value: userId } }];
  if (project) must.push({ key: 'project', match: { value: project } });
  return { must };
}

const projectFilterReady = new Map<string, Promise<void>>();

/**
 * 已有索引的文档里本来就有 project。把它加进可过滤字段后，下一次写入会更新设置；
 * 带 project 的召回若发生在那之前，这里补一次，避免引擎拒绝这个过滤条件、整路变空。
 * 更新失败则退回只按用户过滤，行上的 project 条件仍然生效。
 */
function ensureProjectFilterable(retrieval: RetrievalPorts): Promise<void> {
  const key = `${retrieval.meiliIndex}\0${retrieval.qdrantCollection}`;
  const existing = projectFilterReady.get(key);
  if (existing) return existing;
  let pending!: Promise<void>;
  pending = (async () => {
    try {
      await retrieval.meili.ensureIndex(retrieval.meiliIndex, MEMORY_INDEX_SETTINGS);
      await retrieval.qdrant.ensureCollection(retrieval.qdrantCollection, { payloadFields: ['user_id', 'project'] });
    } catch (err) {
      if (projectFilterReady.get(key) === pending) projectFilterReady.delete(key);
      throw err;
    }
  })();
  projectFilterReady.set(key, pending);
  return pending;
}

export async function indexMemory(retrieval: RetrievalPorts, row: MemoryRow): Promise<void> {
  const failures: unknown[] = [];
  try {
    await retrieval.meili.ensureIndex(retrieval.meiliIndex, MEMORY_INDEX_SETTINGS);
    await retrieval.meili.upsertDocuments(retrieval.meiliIndex, [
      {
        id: row.id,
        user_id: row.userId,
        text: row.content,
        origin: row.origin,
        type: row.type,
        project: row.project,
        session_id: row.sessionId,
      },
    ]);
  } catch (err) {
    failures.push(err);
  }
  try {
    await retrieval.qdrant.ensureCollection(retrieval.qdrantCollection, { payloadFields: ['user_id', 'project'] });
    const [vector] = await retrieval.embeddings.embedTexts([row.content]);
    if (!vector) throw new Error('embedding returned no vector');
    await retrieval.qdrant.upsertPoints(retrieval.qdrantCollection, [
      {
        id: row.id,
        vector,
        payload: { user_id: row.userId, origin: row.origin, type: row.type, project: row.project },
      },
    ]);
  } catch (err) {
    failures.push(err);
  }
  if (failures.length === 0) return;
  const first = failures[0];
  throw first instanceof Error ? first : new Error(String(first));
}

export async function reindexPending(db: Database, retrieval: RetrievalPorts, userId: string): Promise<void> {
  const pending = await db
    .select()
    .from(memories)
    .where(and(eq(memories.userId, userId), isNull(memories.indexedAt)));
  for (const row of pending) {
    try {
      await indexMemory(retrieval, row);
      await db.update(memories).set({ indexedAt: new Date() }).where(eq(memories.id, row.id));
    } catch {
      // Primary row stays. A later successful index makes it recallable.
    }
  }
}

async function lexicalIds(
  retrieval: RetrievalPorts,
  userId: string,
  query: string,
  limit: number,
  project?: string,
): Promise<string[]> {
  const hits = await retrieval.meili.search(retrieval.meiliIndex, {
    q: query,
    filter: meiliUserFilter(userId, project),
    limit,
  });
  return hits.map((hit) => String(hit.id ?? '')).filter((id) => id.length > 0);
}

async function vectorIds(
  retrieval: RetrievalPorts,
  userId: string,
  query: string,
  limit: number,
  project?: string,
): Promise<string[]> {
  const [vector] = await retrieval.embeddings.embedTexts([query]);
  if (!vector) return [];
  const hits = await retrieval.qdrant.queryPoints(
    retrieval.qdrantCollection,
    vector,
    qdrantUserFilter(userId, project),
    limit,
  );
  return hits.map((hit) => hit.id).filter((id) => id.length > 0);
}

/** 精排器：对 RRF 融合后的候选重排，返回按相关度排序的 {id, score} 列表 */
export interface Reranker {
  rerank(query: string, docs: Array<{ id: string; text: string }>): Promise<Array<{ id: string; score: number }>>;
}

export interface RecallOutcome {
  rows: MemoryRow[];
  /** 精排实际生效（false = 未配置精排，或精排失败回退 RRF） */
  rerankApplied: boolean;
  /** 精排相关度分数，按结果 id 索引（精排生效时才有值） */
  rerankScores: Record<string, number>;
  /** 精排失败原因（未尝试或成功时为 null） */
  rerankError: string | null;
}

export interface RecallOptions {
  reranker?: Reranker;
  filter?: MemoryFilter;
  /** 深度模式（smart_search）：更大候选池，容忍过滤损耗 */
  deep?: boolean;
}

function rowMatchesFilter(row: MemoryRow, filter: MemoryFilter): boolean {
  if (filter.origin?.length && !filter.origin.includes(row.origin as Origin)) return false;
  if (filter.type?.length && !filter.type.includes(row.type as never)) return false;
  if (filter.project && row.project !== filter.project) return false;
  if (filter.sessionId && row.sessionId !== filter.sessionId) return false;
  if (filter.createdAfter && row.createdAt < new Date(filter.createdAfter)) return false;
  if (filter.createdBefore && row.createdAt >= new Date(filter.createdBefore)) return false;
  if (filter.tags?.length && !filter.tags.some((tag) => row.tags.includes(tag))) return false;
  return true;
}

export async function recallMemories(
  db: Database,
  retrieval: RetrievalPorts,
  userId: string,
  query: string,
  limit: number,
  options: RecallOptions = {},
): Promise<RecallOutcome> {
  await reindexPending(db, retrieval, userId);
  let project = options.filter?.project;
  if (project) {
    try {
      await ensureProjectFilterable(retrieval);
    } catch (err) {
      console.error(`project search filter unavailable, post-filter only: ${err instanceof Error ? err.message : String(err)}`);
      project = undefined;
    }
  }
  // 标签、时间、会话等仍在取回后过滤，会吃掉一部分候选，所以放大抓取量。
  // project 已经在引擎侧收窄，不再占用这扇窗口。
  const fetchLimit = options.deep
    ? Math.max(limit * 4, 60)
    : options.filter
      ? Math.max(limit * 3, 40)
      : Math.max(limit, 20);
  const [lexical, vector] = await Promise.all([
    lexicalIds(retrieval, userId, query, fetchLimit, project).then(
      (ids) => ({ ok: true as const, ids }),
      () => ({ ok: false as const, ids: [] as string[] }),
    ),
    vectorIds(retrieval, userId, query, fetchLimit, project).then(
      (ids) => ({ ok: true as const, ids }),
      () => ({ ok: false as const, ids: [] as string[] }),
    ),
  ]);
  const lists: string[][] = [];
  if (lexical.ok) lists.push(lexical.ids);
  if (vector.ok) lists.push(vector.ids);
  const fused = rrfMerge(lists);
  if (fused.length === 0) return { rows: [], rerankApplied: false, rerankScores: {}, rerankError: null };
  const rows = await db
    .select()
    .from(memories)
    .where(and(eq(memories.userId, userId), inArray(memories.id, fused)));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const now = new Date();
  // 引擎侧按 user 隔离，并在带 project 时一并收窄。版本链、过期和其余过滤器在取回行后裁决。
  let ordered = fused.filter((id) => {
    const row = byId.get(id);
    if (!row || !row.isLatest) return false;
    if (!options.filter?.includeExpired && row.expiresAt && row.expiresAt < now) return false;
    if (options.filter && !rowMatchesFilter(row, options.filter)) return false;
    return true;
  });
  let rerankApplied = false;
  const rerankScores: Record<string, number> = {};
  let rerankError: string | null = null;
  if (options.reranker && ordered.length > 1) {
    try {
      const docs = ordered.map((id) => {
        const row = byId.get(id);
        return { id, text: row?.content ?? '' };
      });
      const reranked = await options.reranker.rerank(query, docs);
      const seen = new Set<string>();
      for (const item of reranked) {
        seen.add(item.id);
        rerankScores[item.id] = item.score;
      }
      // 精排结果在前，未被精排覆盖的候选保持 RRF 顺序兜底
      ordered = [...reranked.map((item) => item.id).filter((id) => byId.has(id)), ...ordered.filter((id) => !seen.has(id))];
      rerankApplied = true;
    } catch (err) {
      rerankError = publicRerankFailure(err);
      console.error(`rerank failed, keep RRF order: ${rerankError}`);
    }
  }
  return {
    rows: ordered.slice(0, limit).flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    }),
    rerankApplied,
    rerankScores,
    rerankError,
  };
}

export function isOrigin(value: string): value is Origin {
  return value === 'web' || value === 'agent' || value === 'hook' || value === 'import' || value === 'summary';
}
