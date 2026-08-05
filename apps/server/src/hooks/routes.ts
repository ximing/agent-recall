import { hookIngestSchema } from '@agent-recall/dto';
import type { FastifyInstance } from 'fastify';
import { requireActor } from '../auth/authenticate.js';
import { AppError } from '../errors.js';
import { createMemory } from '../memories/service.js';

export function registerHookRoutes(app: FastifyInstance): void {
  app.post('/api/hooks/events', { preHandler: [app.authenticate] }, async (req, reply) => {
    const actor = requireActor(req);
    if (actor.actor !== 'token') throw new AppError(403, 'FORBIDDEN', '钩子需要令牌');
    const input = hookIngestSchema.parse(req.body);
    const memory = await createMemory(app.ctx, actor.userId, input.content, 'hook', input.eventId);
    const created = memory.eventId === input.eventId;
    return reply.code(created ? 201 : 200).send({ memory });
  });
}
