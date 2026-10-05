import '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { AppConfig } from './config.js';
import type { Database } from './db/client.js';
import type { RetrievalPorts } from './retrieval/ports.js';

export interface AppContext {
  db: Database;
  pool: Pool;
  retrieval: RetrievalPorts;
  config: AppConfig;
  closeDb: () => Promise<void>;
}

export type ActorKind = 'session' | 'token';

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    webDistRoot?: string;
  }
  interface FastifyRequest {
    userId: string;
    actor: ActorKind | '';
  }
}
