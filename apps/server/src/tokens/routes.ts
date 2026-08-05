import { tokenCreateSchema } from '@agent-recall/dto';
import type { FastifyInstance } from 'fastify';
import { requireSession } from '../auth/authenticate.js';
import { createAccessToken, listAccessTokens, revokeAccessToken } from '../auth/service.js';

export function registerTokenRoutes(app: FastifyInstance): void {
  app.get('/api/tokens', { preHandler: [app.authenticate] }, async (req) => {
    const userId = requireSession(req);
    return { tokens: await listAccessTokens(app.ctx.db, userId) };
  });

  app.post('/api/tokens', { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = requireSession(req);
    const input = tokenCreateSchema.parse(req.body);
    const created = await createAccessToken(app.ctx.db, userId, input.name);
    return reply.code(201).send(created);
  });

  app.post('/api/tokens/:id/revoke', { preHandler: [app.authenticate] }, async (req) => {
    const userId = requireSession(req);
    const { id } = req.params as { id: string };
    return { token: await revokeAccessToken(app.ctx.db, userId, id) };
  });
}
