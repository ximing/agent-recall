import { hookContextSchema, hookIngestSchema } from '@agent-recall/dto';
import type { FastifyInstance } from 'fastify';
import { requireActor } from '../auth/authenticate.js';
import { AppError } from '../errors.js';
import { buildInjectedContext } from '../memories/context.js';
import { createMemory, type MemoryDeps } from '../memories/service.js';
import { createSessionSummary } from '../memories/sessions.js';
import { redactSecrets } from '../memories/privacy.js';

/** PostToolUse 噪音工具：这些工具的 payload 不值得成为记忆 */
const IGNORED_TOOLS = new Set(['TodoWrite', 'TodoRead', 'ListAgents', 'TaskStop']);

/** 清洗后内容低于该长度的 PostToolUse 观察不入库 */
const MIN_OBSERVATION_LENGTH = 24;

function deps(app: FastifyInstance): MemoryDeps {
  return { db: app.ctx.db, retrieval: app.ctx.retrieval, encryptionKey: app.ctx.config.ENCRYPTION_KEY };
}

export function registerHookRoutes(app: FastifyInstance): void {
  app.post('/api/hooks/events', { preHandler: [app.authenticate] }, async (req, reply) => {
    const actor = requireActor(req);
    if (actor.actor !== 'token') throw new AppError(403, 'FORBIDDEN', '钩子需要令牌');
    const input = hookIngestSchema.parse(req.body);

    if (input.hook === 'PostToolUse' && input.toolName && IGNORED_TOOLS.has(input.toolName)) {
      return reply.code(202).send({ skipped: `ignored tool: ${input.toolName}` });
    }

    // 写入前统一隐私清洗；清洗后过短的工具观察视为噪音
    const { content } = redactSecrets(input.content);
    if (input.hook === 'PostToolUse' && content.trim().length < MIN_OBSERVATION_LENGTH) {
      return reply.code(202).send({ skipped: 'observation too short after redaction' });
    }

    const result = await createMemory(deps(app), actor.userId, {
      content,
      origin: 'hook',
      type: input.type,
      sessionId: input.sessionId,
      project: input.project,
      eventId: input.eventId,
    });

    // SessionEnd：落库后为该会话生成抽取式摘要记忆（幂等）
    if (input.hook === 'SessionEnd' && input.sessionId) {
      try {
        await createSessionSummary(deps(app), actor.userId, input.sessionId, input.project);
      } catch (err) {
        console.error(`session summary for ${input.sessionId} failed:`, err);
      }
    }

    return reply.code(result.deduped ? 200 : 201).send({ memory: result.memory, deduped: result.deduped });
  });

  /**
   * 召回注入（P0 闭环）：UserPromptSubmit / SessionStart 时钩子拿 prompt 文本换
   * 格式化好的、按 token 预算裁剪的记忆上下文，直接注入宿主 prompt。
   */
  app.post('/api/hooks/context', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    if (actor.actor !== 'token') throw new AppError(403, 'FORBIDDEN', '钩子需要令牌');
    const input = hookContextSchema.parse(req.body);
    return buildInjectedContext(deps(app), actor.userId, input);
  });
}
