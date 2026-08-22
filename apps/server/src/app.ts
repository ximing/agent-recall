import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { authenticate } from './auth/authenticate.js';
import { registerAuthRoutes } from './auth/routes.js';
import { registerAdminRoutes } from './admin/routes.js';
import { loadConfig, type AppConfig } from './config.js';
import { openDatabase } from './db/client.js';
import { registerGraphRoutes } from './graph/routes.js';
import { registerHookRoutes } from './hooks/routes.js';
import { registerKvRoutes } from './kv/routes.js';
import { registerMcpRoutes } from './mcp/routes.js';
import { registerMemoryRoutes } from './memories/routes.js';
import { registerMeshRoutes } from './mesh/routes.js';
import { registerSettingsRoutes } from './settings/routes.js';
import { registerSnapshotRoutes } from './snapshots/routes.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { createRetrieval, type RetrievalPorts } from './retrieval/ports.js';
import { registerTokenRoutes } from './tokens/routes.js';
import './types.js';
import { registerWebStatic, resolveWebDist } from './web-static.js';

export interface BuildAppOptions {
  config?: AppConfig;
  databaseUrl?: string;
  schema?: string;
  retrieval?: RetrievalPorts;
  webDist?: string | null;
  logger?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const databaseUrl = options.databaseUrl ?? config.DATABASE_URL;
  const schema = options.schema ?? config.DATABASE_SCHEMA;
  const opened = await openDatabase({ databaseUrl, schema });
  const retrieval = options.retrieval ?? createRetrieval(config);

  const app = Fastify({ logger: options.logger ?? false });
  app.decorate('ctx', { db: opened.db, retrieval, config, closeDb: opened.close });
  app.decorate('authenticate', authenticate);
  app.decorateRequest('userId', '');
  app.decorateRequest('actor', '');

  await app.register(cors, { origin: config.WEB_ORIGIN, credentials: true });
  await app.register(cookie);
  registerErrorHandler(app);

  app.get('/health', async () => ({ ok: true as const }));
  registerAuthRoutes(app);
  registerMemoryRoutes(app);
  registerTokenRoutes(app);
  registerMcpRoutes(app);
  registerHookRoutes(app);
  registerSettingsRoutes(app);
  registerKvRoutes(app);
  registerGraphRoutes(app);
  registerSnapshotRoutes(app);
  registerMeshRoutes(app);
  registerAdminRoutes(app);

  const webDist = options.webDist === undefined ? resolveWebDist(process.env) : options.webDist;
  await registerWebStatic(app, webDist);

  app.addHook('onClose', async () => {
    await opened.close();
  });

  return app;
}
