import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Origin } from '@agent-recall/dto';
import type { Database } from '../db/client.js';
import { memories, type MemoryRow } from '../db/schema.js';
import type { RetrievalPorts } from './ports.js';
import { MEMORY_INDEX_SETTINGS } from './meili.js';
import { rrfMerge } from './rrf.js';

export function meiliUserFilter(userId: string): string {
  return `user_id = "${userId}"`;
}

export function qdrantUserFilter(userId: string): unknown {
  return { must: [{ key: 'user_id', match: { value: userId } }] };
}

export async function indexMemory(retrieval: RetrievalPorts, row: MemoryRow): Promise<void> {
  const failures: unknown[] = [];
  try {
    await retrieval.meili.ensureIndex(retrieval.meiliIndex, MEMORY_INDEX_SETTINGS);
    await retrieval.meili.upsertDocuments(retrieval.meiliIndex, [
      { id: row.id, user_id: row.userId, text: row.content, origin: row.origin },
    ]);
  } catch (err) {
    failures.push(err);
  }
  try {
    await retrieval.qdrant.ensureCollection(retrieval.qdrantCollection, { payloadFields: ['user_id'] });
    const [vector] = await retrieval.embeddings.embedTexts([row.content]);
    if (!vector) throw new Error('embedding returned no vector');
    await retrieval.qdrant.upsertPoints(retrieval.qdrantCollection, [
      { id: row.id, vector, payload: { user_id: row.userId, origin: row.origin } },
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

async function lexicalIds(retrieval: RetrievalPorts, userId: string, query: string, limit: number): Promise<string[]> {
  const hits = await retrieval.meili.search(retrieval.meiliIndex, {
    q: query,
    filter: meiliUserFilter(userId),
    limit,
  });
  return hits.map((hit) => String(hit.id ?? '')).filter((id) => id.length > 0);
}

async function vectorIds(retrieval: RetrievalPorts, userId: string, query: string, limit: number): Promise<string[]> {
  const [vector] = await retrieval.embeddings.embedTexts([query]);
  if (!vector) return [];
  const hits = await retrieval.qdrant.queryPoints(
    retrieval.qdrantCollection,
    vector,
    qdrantUserFilter(userId),
    limit,
  );
  return hits.map((hit) => hit.id).filter((id) => id.length > 0);
}

export async function recallMemories(
  db: Database,
  retrieval: RetrievalPorts,
  userId: string,
  query: string,
  limit: number,
): Promise<MemoryRow[]> {
  await reindexPending(db, retrieval, userId);
  const fetchLimit = Math.max(limit, 20);
  const [lexical, vector] = await Promise.all([
    lexicalIds(retrieval, userId, query, fetchLimit).then(
      (ids) => ({ ok: true as const, ids }),
      () => ({ ok: false as const, ids: [] as string[] }),
    ),
    vectorIds(retrieval, userId, query, fetchLimit).then(
      (ids) => ({ ok: true as const, ids }),
      () => ({ ok: false as const, ids: [] as string[] }),
    ),
  ]);
  const lists: string[][] = [];
  if (lexical.ok) lists.push(lexical.ids);
  if (vector.ok) lists.push(vector.ids);
  const fused = rrfMerge(lists).slice(0, limit);
  if (fused.length === 0) return [];
  const rows = await db
    .select()
    .from(memories)
    .where(and(eq(memories.userId, userId), inArray(memories.id, fused)));
  const byId = new Map(rows.map((row) => [row.id, row]));
  return fused.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
}

export function isOrigin(value: string): value is Origin {
  return value === 'web' || value === 'agent' || value === 'hook';
}
