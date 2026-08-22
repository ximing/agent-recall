import { randomUUID } from 'node:crypto';
import {
  exportResultSchema,
  snapshotCreateSchema,
  snapshotRestoreSchema,
  type SnapshotPublic,
} from '@agent-recall/dto';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { recordAudit } from '../audit/log.js';
import { requireActor } from '../auth/authenticate.js';
import { snapshots, type SnapshotRow } from '../db/schema.js';
import { AppError } from '../errors.js';
import { exportMemories, importMemories } from '../memories/governance.js';
import type { MemoryDeps } from '../memories/service.js';

function deps(app: FastifyInstance): MemoryDeps {
  return { db: app.ctx.db, retrieval: app.ctx.retrieval, encryptionKey: app.ctx.config.ENCRYPTION_KEY };
}

function toSnapshot(row: SnapshotRow): SnapshotPublic {
  return {
    id: row.id,
    note: row.note,
    memoryCount: row.memoryCount,
    createdAt: row.createdAt.toISOString(),
  };
}

export function registerSnapshotRoutes(app: FastifyInstance): void {
  /** 落一份完整 export 负载快照（data 不回传） */
  app.post('/api/snapshots', { preHandler: [app.authenticate] }, async (req, reply) => {
    const actor = requireActor(req);
    const input = snapshotCreateSchema.parse(req.body ?? {});
    const data = await exportMemories(deps(app), actor.userId);
    const inserted = await deps(app)
      .db.insert(snapshots)
      .values({
        id: randomUUID(),
        userId: actor.userId,
        note: input.note ?? null,
        memoryCount: data.memories.length,
        data,
        createdAt: new Date(),
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new AppError(500, 'INTERNAL', '快照创建失败');
    return reply.code(201).send({ snapshot: toSnapshot(row) });
  });

  app.get('/api/snapshots', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    const rows = await deps(app)
      .db.select({
        id: snapshots.id,
        userId: snapshots.userId,
        note: snapshots.note,
        memoryCount: snapshots.memoryCount,
        createdAt: snapshots.createdAt,
      })
      .from(snapshots)
      .where(eq(snapshots.userId, actor.userId))
      .orderBy(desc(snapshots.createdAt))
      .limit(200);
    return { snapshots: rows.map((r) => toSnapshot(r as SnapshotRow)) };
  });

  /** 回放快照：skip/merge 跳过同 id，replace 覆盖同 id */
  app.post('/api/snapshots/:id/restore', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const input = snapshotRestoreSchema.parse(req.body ?? {});
    const rows = await deps(app)
      .db.select()
      .from(snapshots)
      .where(and(eq(snapshots.id, id), eq(snapshots.userId, actor.userId)));
    const row = rows[0];
    if (!row) throw new AppError(404, 'NOT_FOUND', '快照不存在');
    const data = exportResultSchema.parse(row.data);
    const result = await importMemories(deps(app), actor.userId, {
      memories: data.memories,
      strategy: input.strategy ?? 'skip',
    });
    await recordAudit(deps(app).db, actor.userId, 'snapshot.restore', {
      snapshotId: id,
      strategy: input.strategy ?? 'skip',
      ...result,
    });
    return result;
  });
}
