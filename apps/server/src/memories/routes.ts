import { memoryCreateSchema, memoryUpdateSchema, recallSchema } from '@agent-recall/dto';
import type { FastifyInstance } from 'fastify';
import { requireActor } from '../auth/authenticate.js';
import { createMemory, deleteMemory, getMemory, listMemories, recallForUser, updateMemory } from './service.js';

export function registerMemoryRoutes(app: FastifyInstance): void {
  const deps = () => app.ctx;

  app.post('/api/memories/recall', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    const input = recallSchema.parse(req.body);
    const memories = await recallForUser(deps(), actor.userId, input.query, input.limit ?? 10);
    return { memories };
  });

  app.post('/api/memories/smart-search', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    const input = recallSchema.parse(req.body);
    const memories = await recallForUser(deps(), actor.userId, input.query, input.limit ?? 10);
    return { memories };
  });

  app.get('/api/memories', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    return { memories: await listMemories(deps(), actor.userId) };
  });

  app.post('/api/memories', { preHandler: [app.authenticate] }, async (req, reply) => {
    const actor = requireActor(req);
    const input = memoryCreateSchema.parse(req.body);
    const origin = actor.actor === 'session' ? 'web' : 'agent';
    const memory = await createMemory(deps(), actor.userId, input.content, origin);
    return reply.code(201).send({ memory });
  });

  app.get('/api/memories/:id', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    return { memory: await getMemory(deps(), actor.userId, id) };
  });

  app.patch('/api/memories/:id', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const input = memoryUpdateSchema.parse(req.body);
    return { memory: await updateMemory(deps(), actor.userId, id, input.content) };
  });

  app.delete('/api/memories/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    await deleteMemory(deps(), actor.userId, id);
    return reply.code(204).send();
  });
}
