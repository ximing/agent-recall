import { settingsUpdateSchema } from '@agent-recall/dto';
import type { FastifyInstance } from 'fastify';
import { requireActor } from '../auth/authenticate.js';
import { assertRerankBaseUrl } from '../retrieval/url-guard.js';
import { getSettings, toSettings, updateSettings } from './service.js';

export function registerSettingsRoutes(app: FastifyInstance): void {
  const deps = () => app.ctx;
  const encryptionKey = () => app.ctx.config.ENCRYPTION_KEY;

  app.get('/api/settings', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    const row = await getSettings(deps().db, actor.userId);
    return { settings: toSettings(row, encryptionKey()) };
  });

  app.put('/api/settings', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    const input = settingsUpdateSchema.parse(req.body);
    if (input.rerankBaseUrl !== undefined) {
      await assertRerankBaseUrl(input.rerankBaseUrl, { appEnv: app.ctx.config.APP_ENV });
    }
    const row = await updateSettings(deps().db, actor.userId, input, encryptionKey());
    return { settings: toSettings(row, encryptionKey()) };
  });
}
