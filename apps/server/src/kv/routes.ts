import { kvAppendSchema, kvKeySchema, kvNamespaceSchema, kvPutSchema, type KvEntryPublic } from '@agent-recall/dto';
import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireActor } from '../auth/authenticate.js';
import type { Database } from '../db/client.js';
import { kvEntries, type KvEntryRow } from '../db/schema.js';
import { AppError } from '../errors.js';

function toEntry(row: KvEntryRow): KvEntryPublic {
  return {
    namespace: row.namespace,
    key: row.key,
    value: row.value,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function parseParams(req: FastifyRequest): { namespace: string; key: string } {
  const params = req.params as { namespace: string; key: string };
  return {
    namespace: kvNamespaceSchema.parse(params.namespace),
    key: kvKeySchema.parse(params.key),
  };
}

/** 取出未过期条目；过期的顺手删除并视为不存在 */
async function liveEntry(db: Database, userId: string, namespace: string, key: string): Promise<KvEntryRow | undefined> {
  const rows = await db
    .select()
    .from(kvEntries)
    .where(and(eq(kvEntries.userId, userId), eq(kvEntries.namespace, namespace), eq(kvEntries.key, key)));
  const row = rows[0];
  if (!row) return undefined;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    await db
      .delete(kvEntries)
      .where(and(eq(kvEntries.userId, userId), eq(kvEntries.namespace, namespace), eq(kvEntries.key, key)));
    return undefined;
  }
  return row;
}

export function registerKvRoutes(app: FastifyInstance): void {
  const db = () => app.ctx.db;

  app.put('/api/kv/:namespace/:key', { preHandler: [app.authenticate] }, async (req, reply) => {
    const actor = requireActor(req);
    const { namespace, key } = parseParams(req);
    const input = kvPutSchema.parse(req.body ?? {});
    const expiresAt = input.ttlSeconds ? new Date(Date.now() + input.ttlSeconds * 1000) : null;
    const now = new Date();

    const existing = await liveEntry(db(), actor.userId, namespace, key);
    if (existing && input.ifAbsent) {
      // lease 语义：持有中，409 并返回当前条目
      return reply.code(409).send({ held: true, entry: toEntry(existing) });
    }
    let row: KvEntryRow;
    if (existing) {
      const updated = await db()
        .update(kvEntries)
        .set({ value: input.value ?? null, expiresAt, updatedAt: now })
        .where(and(eq(kvEntries.userId, actor.userId), eq(kvEntries.namespace, namespace), eq(kvEntries.key, key)))
        .returning();
      row = updated[0]!;
    } else {
      const inserted = await db()
        .insert(kvEntries)
        .values({
          userId: actor.userId,
          namespace,
          key,
          value: input.value ?? null,
          expiresAt,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      row = inserted[0]!;
    }
    return { entry: toEntry(row) };
  });

  app.get('/api/kv/:namespace/:key', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    const { namespace, key } = parseParams(req);
    const row = await liveEntry(db(), actor.userId, namespace, key);
    if (!row) throw new AppError(404, 'NOT_FOUND', '条目不存在或已过期');
    return { entry: toEntry(row) };
  });

  app.delete('/api/kv/:namespace/:key', { preHandler: [app.authenticate] }, async (req, reply) => {
    const actor = requireActor(req);
    const { namespace, key } = parseParams(req);
    await db()
      .delete(kvEntries)
      .where(and(eq(kvEntries.userId, actor.userId), eq(kvEntries.namespace, namespace), eq(kvEntries.key, key)));
    return reply.code(204).send();
  });

  app.get('/api/kv/:namespace', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    const { namespace } = req.params as { namespace: string };
    const ns = kvNamespaceSchema.parse(namespace);
    const q = req.query as { limit?: string };
    const parsed = q.limit ? Number.parseInt(q.limit, 10) : NaN;
    const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 500) : 100;
    const rows = await db()
      .select()
      .from(kvEntries)
      .where(
        and(
          eq(kvEntries.userId, actor.userId),
          eq(kvEntries.namespace, ns),
          or(isNull(kvEntries.expiresAt), gt(kvEntries.expiresAt, new Date())),
        ),
      )
      .orderBy(desc(kvEntries.updatedAt))
      .limit(limit);
    return { entries: rows.map(toEntry) };
  });

  app.post('/api/kv/:namespace/:key/append', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    const { namespace, key } = parseParams(req);
    const input = kvAppendSchema.parse(req.body ?? {});
    const now = new Date();

    const existing = await liveEntry(db(), actor.userId, namespace, key);
    let row: KvEntryRow;
    if (existing) {
      if (!Array.isArray(existing.value)) {
        throw new AppError(409, 'CONFLICT', '现有值不是数组，无法追加');
      }
      const next = [...(existing.value as unknown[]), input.value ?? null];
      const updated = await db()
        .update(kvEntries)
        .set({ value: next, updatedAt: now })
        .where(and(eq(kvEntries.userId, actor.userId), eq(kvEntries.namespace, namespace), eq(kvEntries.key, key)))
        .returning();
      row = updated[0]!;
    } else {
      const inserted = await db()
        .insert(kvEntries)
        .values({
          userId: actor.userId,
          namespace,
          key,
          value: [input.value ?? null],
          expiresAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      row = inserted[0]!;
    }
    return { entry: toEntry(row) };
  });
}
