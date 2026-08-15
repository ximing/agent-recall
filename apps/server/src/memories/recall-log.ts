import { randomUUID } from 'node:crypto';
import type { RecallLogPublic, RecallStrategy } from '@agent-recall/dto';
import { and, desc, eq, lt } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { recallLogs, type RecallLogRow } from '../db/schema.js';

/** 召回历史保留 30 天，写入时滚动清理 */
const RETENTION_MS = 30 * 24 * 3600 * 1000;
const CONTENT_SNAPSHOT_LENGTH = 200;

export interface RecallLogEntry {
  userId: string;
  query: string;
  strategy: RecallStrategy;
  rerankModel: string | null;
  rerankApplied: boolean;
  rerankError: string | null;
  /** score = 精排相关度分数（精排未生效时为 null） */
  results: Array<{ id: string; content: string; score: number | null }>;
  latencyMs: number;
}

export async function recordRecallLog(db: Database, entry: RecallLogEntry): Promise<void> {
  try {
    await db.insert(recallLogs).values({
      id: randomUUID(),
      userId: entry.userId,
      query: entry.query,
      strategy: entry.strategy,
      rerankModel: entry.rerankModel,
      rerankApplied: entry.rerankApplied,
      rerankError: entry.rerankError,
      results: entry.results.map((result) => ({
        id: result.id,
        content: result.content.slice(0, CONTENT_SNAPSHOT_LENGTH),
        score: result.score,
      })),
      latencyMs: entry.latencyMs,
      createdAt: new Date(),
    });
    await db
      .delete(recallLogs)
      .where(and(eq(recallLogs.userId, entry.userId), lt(recallLogs.createdAt, new Date(Date.now() - RETENTION_MS))));
  } catch (err) {
    // 日志失败不影响召回主链路
    console.error(`record recall log failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function toRecallLog(row: RecallLogRow): RecallLogPublic {
  return {
    id: row.id,
    query: row.query,
    strategy: row.strategy as RecallStrategy,
    rerankModel: row.rerankModel,
    rerankApplied: row.rerankApplied,
    rerankError: row.rerankError,
    resultCount: row.results.length,
    results: row.results.map((result) => ({
      id: result.id,
      content: result.content,
      score: typeof result.score === 'number' ? result.score : null,
    })),
    latencyMs: row.latencyMs,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date(row.createdAt).toISOString(),
  };
}

export async function listRecallLogs(db: Database, userId: string, limit = 50): Promise<RecallLogPublic[]> {
  const rows = await db
    .select()
    .from(recallLogs)
    .where(eq(recallLogs.userId, userId))
    .orderBy(desc(recallLogs.createdAt))
    .limit(limit);
  return rows.map(toRecallLog);
}
