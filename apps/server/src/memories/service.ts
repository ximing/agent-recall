import { randomUUID } from 'node:crypto';
import type { MemoryPublic, Origin } from '@agent-recall/dto';
import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { memories, type MemoryRow } from '../db/schema.js';
import { isUniqueViolation } from '../db/errors.js';
import { AppError } from '../errors.js';
import type { RetrievalPorts } from '../retrieval/ports.js';
import { indexMemory, recallMemories } from '../retrieval/recall.js';

export interface MemoryDeps {
  db: Database;
  retrieval: RetrievalPorts;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function toMemory(row: MemoryRow): MemoryPublic {
  return {
    id: row.id,
    content: row.content,
    origin: row.origin as Origin,
    eventId: row.eventId,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
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

export async function createMemory(
  deps: MemoryDeps,
  userId: string,
  content: string,
  origin: Origin,
  eventId?: string,
): Promise<MemoryPublic> {
  if (eventId) {
    const existing = await deps.db
      .select()
      .from(memories)
      .where(and(eq(memories.userId, userId), eq(memories.eventId, eventId)));
    const prior = existing[0];
    if (prior) return toMemory(prior);
  }

  const now = new Date();
  try {
    const inserted = await deps.db
      .insert(memories)
      .values({
        id: randomUUID(),
        userId,
        content,
        origin,
        eventId: eventId ?? null,
        indexedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new AppError(500, 'INTERNAL', '写入记忆失败');
    await tryIndex(deps, row);
    return toMemory(row);
  } catch (err) {
    if (eventId && isUniqueViolation(err)) {
      const again = await deps.db
        .select()
        .from(memories)
        .where(and(eq(memories.userId, userId), eq(memories.eventId, eventId)));
      const prior = again[0];
      if (prior) return toMemory(prior);
    }
    throw err;
  }
}

export async function listMemories(deps: MemoryDeps, userId: string): Promise<MemoryPublic[]> {
  const rows = await deps.db
    .select()
    .from(memories)
    .where(eq(memories.userId, userId))
    .orderBy(desc(memories.createdAt));
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

export async function updateMemory(
  deps: MemoryDeps,
  userId: string,
  id: string,
  content: string,
): Promise<MemoryPublic> {
  const existing = await deps.db
    .select()
    .from(memories)
    .where(and(eq(memories.id, id), eq(memories.userId, userId)));
  const row = existing[0];
  if (!row) throw new AppError(404, 'NOT_FOUND', '记忆不存在');
  const updatedAt = new Date();
  const updated = await deps.db
    .update(memories)
    .set({ content, updatedAt, indexedAt: null })
    .where(eq(memories.id, row.id))
    .returning();
  const next = updated[0];
  if (!next) throw new AppError(500, 'INTERNAL', '更新记忆失败');
  await tryIndex(deps, next);
  return toMemory(next);
}

export async function deleteMemory(deps: MemoryDeps, userId: string, id: string): Promise<void> {
  const existing = await deps.db
    .select()
    .from(memories)
    .where(and(eq(memories.id, id), eq(memories.userId, userId)));
  const row = existing[0];
  if (!row) throw new AppError(404, 'NOT_FOUND', '记忆不存在');
  await deps.db.delete(memories).where(eq(memories.id, row.id));
  try {
    await deps.retrieval.meili.deleteDocuments(deps.retrieval.meiliIndex, [row.id]);
    await deps.retrieval.qdrant.deletePoints(deps.retrieval.qdrantCollection, [row.id]);
  } catch {
    // The primary row is already gone.
  }
}

export async function recallForUser(
  deps: MemoryDeps,
  userId: string,
  query: string,
  limit: number,
): Promise<MemoryPublic[]> {
  const rows = await recallMemories(deps.db, deps.retrieval, userId, query, limit);
  return rows.map(toMemory);
}
