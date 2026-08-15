import { settingsUpdateSchema } from '@agent-recall/dto';
import type { FastifyInstance } from 'fastify';
import { requireActor } from '../auth/authenticate.js';
import { getSettings, toSettings, updateSettings } from './service.js';

export function registerSettingsRoutes(app: FastifyInstance): void {
  const deps = () => app.ctx;
  const dataDir = () => app.ctx.config.dataDir;

  app.get('/api/settings', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    const row = await getSettings(deps().db, actor.userId);
    return { settings: toSettings(row, dataDir()) };
  });

  app.put('/api/settings', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    const input = settingsUpdateSchema.parse(req.body);
    const row = await updateSettings(deps().db, actor.userId, input, dataDir());
    return { settings: toSettings(row, dataDir()) };
  });
}
