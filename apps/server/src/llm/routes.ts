import { createLlmConfigSchema, updateLlmConfigSchema } from '@agent-recall/dto';
import type { FastifyInstance } from 'fastify';
import { requireActor } from '../auth/authenticate.js';
import {
  createLlmConfig,
  deleteLlmConfig,
  listLlmConfigs,
  setDefaultLlmConfig,
  testLlmConfig,
  updateLlmConfig,
} from './service.js';
import { listLlmUsage } from './usage.js';

export function registerLlmRoutes(app: FastifyInstance): void {
  const db = () => app.ctx.db;
  const key = () => app.ctx.config.ENCRYPTION_KEY;
  const appEnv = () => app.ctx.config.APP_ENV;

  app.get('/api/llm-configs', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    return { configs: await listLlmConfigs(db(), actor.userId, key()) };
  });

  app.post('/api/llm-configs', { preHandler: [app.authenticate] }, async (req, reply) => {
    const actor = requireActor(req);
    const input = createLlmConfigSchema.parse(req.body);
    const config = await createLlmConfig(db(), actor.userId, input, key(), appEnv());
    return reply.code(201).send({ config });
  });

  app.put('/api/llm-configs/:id', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const input = updateLlmConfigSchema.parse(req.body ?? {});
    return { config: await updateLlmConfig(db(), actor.userId, id, input, key(), appEnv()) };
  });

  app.delete('/api/llm-configs/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    await deleteLlmConfig(db(), actor.userId, id);
    return reply.code(204).send();
  });

  app.put('/api/llm-configs/:id/default', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    return { config: await setDefaultLlmConfig(db(), actor.userId, id, key()) };
  });

  app.post('/api/llm-configs/:id/test', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    return testLlmConfig(db(), actor.userId, id, key(), appEnv());
  });

  app.get('/api/llm-usage', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    const raw = (req.query as { limit?: string }).limit;
    const parsed = raw ? Number.parseInt(raw, 10) : 50;
    const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : 50;
    return listLlmUsage(db(), actor.userId, limit);
  });
}
