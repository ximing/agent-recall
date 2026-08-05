import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

export function resolveWebDist(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.WEB_DIST && existsSync(path.join(env.WEB_DIST, 'index.html'))) return env.WEB_DIST;
  if (env.NODE_ENV !== 'production') return null;
  const dist = fileURLToPath(new URL('../../web/dist/', import.meta.url));
  return existsSync(path.join(dist, 'index.html')) ? dist : null;
}

export async function registerWebStatic(app: FastifyInstance, dist: string | null): Promise<void> {
  if (dist) {
    app.webDistRoot = dist;
    await app.register(fastifyStatic, {
      root: dist,
      prefix: '/',
      wildcard: false,
    });
  }

  app.setNotFoundHandler((req, reply) => {
    if (app.webDistRoot && req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/health')) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '不存在' } });
  });
}
