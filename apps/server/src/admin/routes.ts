import type { DiagnoseProblem, DiagnoseResult, HealResult } from '@agent-recall/dto';
import { and, count, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { listAuditEntries, recordAudit } from '../audit/log.js';
import { requireActor } from '../auth/authenticate.js';
import { memories } from '../db/schema.js';
import { autoForget, memoryStats } from '../memories/governance.js';
import type { MemoryDeps } from '../memories/service.js';
import { reindexPending } from '../retrieval/recall.js';
import { getRerankApiKey, getSettings } from '../settings/service.js';

function deps(app: FastifyInstance): MemoryDeps {
  return { db: app.ctx.db, retrieval: app.ctx.retrieval, encryptionKey: app.ctx.config.ENCRYPTION_KEY };
}

async function pendingIndexCount(app: FastifyInstance, userId: string): Promise<number> {
  const [row] = await app.ctx.db
    .select({ n: count() })
    .from(memories)
    .where(and(eq(memories.userId, userId), eq(memories.isLatest, true), isNull(memories.indexedAt)));
  return row?.n ?? 0;
}

export function registerAdminRoutes(app: FastifyInstance): void {
  /** 诊断：汇总可自愈的问题与修复建议 */
  app.get('/api/admin/diagnose', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    const d = deps(app);
    const stats = await memoryStats(d, actor.userId);
    const problems: DiagnoseProblem[] = [];

    if (stats.pendingIndex > 0) {
      problems.push({
        code: 'PENDING_INDEX',
        message: `${stats.pendingIndex} 条记忆未进入检索索引`,
        fix: '调用 POST /api/admin/heal 重新索引',
      });
    }
    if (stats.expired > 0) {
      problems.push({
        code: 'EXPIRED_MEMORIES',
        message: `${stats.expired} 条记忆已过期未清理`,
        fix: '调用 POST /api/admin/heal（内部执行 auto-forget）',
      });
    }
    const config = app.ctx.config;
    if (!config.MEILI_URL) {
      problems.push({
        code: 'MEILI_NOT_CONFIGURED',
        message: '未配置 MEILI_URL，词法检索不可用',
        fix: '在环境变量中配置 MEILI_URL / MEILI_API_KEY',
      });
    }
    if (!config.QDRANT_URL) {
      problems.push({
        code: 'QDRANT_NOT_CONFIGURED',
        message: '未配置 QDRANT_URL，向量检索不可用',
        fix: '在环境变量中配置 QDRANT_URL / QDRANT_API_KEY',
      });
    }
    if (!config.EMBEDDING_API_KEY) {
      problems.push({
        code: 'EMBEDDING_NOT_CONFIGURED',
        message: '未配置 EMBEDDING_API_KEY，向量嵌入不可用',
        fix: '在环境变量中配置 EMBEDDING_API_KEY',
      });
    }
    const settings = await getSettings(d.db, actor.userId);
    if (settings.rerankEnabled && !getRerankApiKey(settings, d.encryptionKey)) {
      problems.push({
        code: 'RERANK_NO_KEY',
        message: '已开启精排但未配置 API Key，实际回退为 RRF',
        fix: '在设置页保存 rerank API Key，或关闭精排',
      });
    }

    const result: DiagnoseResult = { ok: problems.length === 0, problems, stats };
    return result;
  });

  /** 自愈：补齐索引 + 自动遗忘 */
  app.post('/api/admin/heal', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    const d = deps(app);
    const before = await pendingIndexCount(app, actor.userId);
    await reindexPending(d.db, d.retrieval, actor.userId);
    const after = await pendingIndexCount(app, actor.userId);
    const forget = await autoForget(d, actor.userId, false);
    const result: HealResult = { reindexed: Math.max(before - after, 0), autoForget: forget };
    await recordAudit(d.db, actor.userId, 'admin.heal', {
      reindexed: result.reindexed,
      autoForgetDeleted: forget.deleted,
    });
    return result;
  });

  /** 审计流水：按时间倒序 */
  app.get('/api/audit', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    const q = req.query as { limit?: string };
    const parsed = q.limit ? Number.parseInt(q.limit, 10) : NaN;
    const limit = Number.isFinite(parsed) ? parsed : 100;
    return { entries: await listAuditEntries(app.ctx.db, actor.userId, limit) };
  });
}
