import { mcpCreateSchema } from '@agent-recall/dto';
import type { FastifyInstance } from 'fastify';
import { requireSession } from '../auth/authenticate.js';
import { createMcpClient, listMcpClients, revokeMcpClient } from '../auth/service.js';
import { renderMcpConfig } from './config.js';

export function registerMcpRoutes(app: FastifyInstance): void {
  app.get('/api/mcp/clients', { preHandler: [app.authenticate] }, async (req) => {
    const userId = requireSession(req);
    return { clients: await listMcpClients(app.ctx.db, userId) };
  });

  app.post('/api/mcp/clients', { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = requireSession(req);
    const input = mcpCreateSchema.parse(req.body);
    const created = await createMcpClient(app.ctx.db, userId, input.name);
    const baseUrl = app.ctx.config.PUBLIC_BASE_URL.replace(/\/$/, '');
    return reply.code(201).send({
      client: created.client,
      secret: created.secret,
      baseUrl,
      config: renderMcpConfig(baseUrl, created.secret),
    });
  });

  app.post('/api/mcp/clients/:id/revoke', { preHandler: [app.authenticate] }, async (req) => {
    const userId = requireSession(req);
    const { id } = req.params as { id: string };
    return { client: await revokeMcpClient(app.ctx.db, userId, id) };
  });
}
