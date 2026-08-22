import {
  batchForgetSchema,
  consolidateSchema,
  hookContextSchema,
  importSchema,
  memoryCreateSchema,
  memoryFilterSchema,
  memoryUpdateSchema,
  recallSchema,
  reflectSchema,
  shareSchema,
  type MemoryFilter,
} from '@agent-recall/dto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireActor } from '../auth/authenticate.js';
import {
  createMemory,
  deleteMemory,
  getMemory,
  getMemoryVersions,
  listMemories,
  recallForUser,
  updateMemory,
} from './service.js';
import { autoForget, batchForget, exportMemories, importMemories, memoryStats } from './governance.js';
import { createSessionSummary, listSessions, sessionTimeline } from './sessions.js';
import { buildInjectedContext } from './context.js';
import { consolidateMemories, reflectMemories, sharedFeed, shareMemory } from './ops.js';
import { listRecallLogs } from './recall-log.js';

function parseListQuery(req: FastifyRequest): { filter?: MemoryFilter; limit?: number; offset?: number } {
  const q = req.query as Record<string, string | undefined>;
  const csv = (value?: string) =>
    value
      ?.split(',')
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  const filterRaw: Record<string, unknown> = {};
  const origin = csv(q.origin);
  const type = csv(q.type);
  const tags = csv(q.tags);
  if (origin) filterRaw.origin = origin;
  if (type) filterRaw.type = type;
  if (tags) filterRaw.tags = tags;
  if (q.project) filterRaw.project = q.project;
  if (q.sessionId) filterRaw.sessionId = q.sessionId;
  if (q.createdAfter) filterRaw.createdAfter = q.createdAfter;
  if (q.createdBefore) filterRaw.createdBefore = q.createdBefore;
  if (q.includeExpired === 'true') filterRaw.includeExpired = true;
  const filter = Object.keys(filterRaw).length > 0 ? memoryFilterSchema.parse(filterRaw) : undefined;
  const limit = q.limit ? Number.parseInt(q.limit, 10) : undefined;
  const offset = q.offset ? Number.parseInt(q.offset, 10) : undefined;
  return {
    filter,
    limit: limit !== undefined && Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 500) : undefined,
    offset: offset !== undefined && Number.isFinite(offset) ? Math.max(offset, 0) : undefined,
  };
}

export function registerMemoryRoutes(app: FastifyInstance): void {
  const deps = () => ({ db: app.ctx.db, retrieval: app.ctx.retrieval, encryptionKey: app.ctx.config.ENCRYPTION_KEY });

  app.get('/api/memories/recall-logs', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    return { logs: await listRecallLogs(deps().db, actor.userId) };
  });

  app.post('/api/memories/recall', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    const input = recallSchema.parse(req.body);
    const result = await recallForUser(deps(), actor.userId, input.query, input.limit ?? 10, {
      filter: input.filter,
    });
    return { memories: result.memories };
  });

  app.post('/api/memories/smart-search', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    const input = recallSchema.parse(req.body);
    const result = await recallForUser(deps(), actor.userId, input.query, input.limit ?? 10, {
      filter: input.filter,
      deep: true,
    });
    return { memories: result.memories, scores: result.scores, strategy: result.strategy };
  });

  /** 控制台预览插件注入。格式与 /api/hooks/context 相同，网页 session 也能调用。 */
  app.post('/api/memories/context', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    const input = hookContextSchema.parse(req.body);
    return buildInjectedContext(deps(), actor.userId, input);
  });

  app.get('/api/memories/stats', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    return { stats: await memoryStats(deps(), actor.userId) };
  });

  app.get('/api/memories/export', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    return exportMemories(deps(), actor.userId);
  });

  app.post('/api/memories/import', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    const input = importSchema.parse(req.body);
    return importMemories(deps(), actor.userId, input);
  });

  app.post('/api/memories/batch-forget', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    const input = batchForgetSchema.parse(req.body);
    return batchForget(deps(), actor.userId, input);
  });

  app.post('/api/memories/auto-forget', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    const body = (req.body ?? {}) as { dryRun?: boolean };
    return autoForget(deps(), actor.userId, body.dryRun ?? false);
  });

  /** 团队共享：把记忆清洗后复制到目标用户库（eventId 幂等） */
  app.post('/api/memories/:id/share', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const input = shareSchema.parse(req.body);
    await shareMemory(deps(), actor.userId, id, input.email);
    return { shared: true as const };
  });

  /** 共享订阅：tags 含 'shared' 的最新版记忆 */
  app.get('/api/memories/shared-feed', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    return { memories: await sharedFeed(deps(), actor.userId) };
  });

  /** 近重复合并：同 contentHash 的多条链只保留最新一条 */
  app.post('/api/memories/consolidate', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    const input = consolidateSchema.parse(req.body ?? {});
    return consolidateMemories(deps(), actor.userId, input.dryRun ?? false);
  });

  /** 反思：近 N 天 lesson/pattern/bug 的抽取式汇总，当日幂等 */
  app.post('/api/memories/reflect', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    const input = reflectSchema.parse(req.body ?? {});
    const result = await reflectMemories(deps(), actor.userId, input);
    return { memory: result.memory, deduped: result.deduped };
  });

  /** 会话结晶：手动触发摘要，eventId 按日期+小时幂等 */
  app.post('/api/sessions/:sessionId/crystallize', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    const { sessionId } = req.params as { sessionId: string };
    const hour = new Date().toISOString().slice(0, 13);
    const eventId = `crystal:${sessionId}:${hour}`.slice(0, 128);
    const result = await createSessionSummary(deps(), actor.userId, sessionId, undefined, eventId);
    return { memory: result.memory };
  });

  app.get('/api/sessions', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    return { sessions: await listSessions(deps(), actor.userId) };
  });

  app.get('/api/sessions/:sessionId', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    const { sessionId } = req.params as { sessionId: string };
    return { memories: await sessionTimeline(deps(), actor.userId, sessionId) };
  });

  app.get('/api/memories', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    const query = parseListQuery(req);
    return { memories: await listMemories(deps(), actor.userId, query) };
  });

  app.post('/api/memories', { preHandler: [app.authenticate] }, async (req, reply) => {
    const actor = requireActor(req);
    const input = memoryCreateSchema.parse(req.body);
    const origin = actor.actor === 'session' ? 'web' : 'agent';
    const result = await createMemory(deps(), actor.userId, {
      content: input.content,
      origin,
      type: input.type,
      tags: input.tags,
      project: input.project,
      sessionId: input.sessionId,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
    });
    return reply.code(result.deduped ? 200 : 201).send({ memory: result.memory, deduped: result.deduped });
  });

  app.get('/api/memories/:id', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    return { memory: await getMemory(deps(), actor.userId, id) };
  });

  app.get('/api/memories/:id/versions', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    return { versions: await getMemoryVersions(deps(), actor.userId, id) };
  });

  app.patch('/api/memories/:id', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const input = memoryUpdateSchema.parse(req.body);
    return {
      memory: await updateMemory(deps(), actor.userId, id, {
        content: input.content,
        type: input.type,
        tags: input.tags,
        expiresAt: input.expiresAt === undefined ? undefined : input.expiresAt === null ? null : new Date(input.expiresAt),
      }),
    };
  });

  app.delete('/api/memories/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    await deleteMemory(deps(), actor.userId, id);
    return reply.code(204).send();
  });
}
