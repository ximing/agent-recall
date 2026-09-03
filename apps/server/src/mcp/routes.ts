import { mcpCreateSchema } from '@agent-recall/dto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireActor, requireSession } from '../auth/authenticate.js';
import { createMcpClient, listMcpClients, revokeMcpClient } from '../auth/service.js';
import { AppError } from '../errors.js';
import { callServerTool, listServerTools, McpCallError, parseProfile } from './bridge.js';
import { renderMcpConfig } from './config.js';

const mcpToolCallSchema = z.object({
  name: z.string().trim().min(1).max(80),
  arguments: z.record(z.unknown()).optional(),
  profile: z.string().max(32).optional(),
});

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

  app.get('/api/mcp/tools', { preHandler: [app.authenticate] }, async (req) => {
    requireActor(req);
    const profile = parseProfile((req.query as { profile?: string }).profile);
    return { profile, tools: listServerTools(profile) };
  });

  app.post('/api/mcp/tools/call', { preHandler: [app.authenticate] }, async (req, reply) => {
    requireActor(req);
    const body = mcpToolCallSchema.parse(req.body ?? {});
    const authorization = req.headers.authorization;
    if (!authorization) throw new AppError(401, 'UNAUTHORIZED', '未登录');
    try {
      return await callServerTool(app, authorization, parseProfile(body.profile), body.name, body.arguments ?? {});
    } catch (err) {
      if (err instanceof McpCallError) {
        return reply.code(400).send({ error: { code: 'MCP_TOOL', message: err.message, rpcCode: err.rpcCode } });
      }
      throw err;
    }
  });
}
