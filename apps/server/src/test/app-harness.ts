import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from 'dotenv';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { loadConfig, type AppConfig } from '../config.js';
import { createSchemaName, dropSchema } from '../db/client.js';
import { envFilePath, serverRoot } from '../env.js';
import type { RetrievalPorts } from '../retrieval/ports.js';

let cachedTestDatabaseUrl: string | undefined;

/** Reads apps/server/.env.test only. A shell DATABASE_URL is ignored so tests cannot hit production. */
export function testDatabaseUrl(): string {
  if (cachedTestDatabaseUrl) return cachedTestDatabaseUrl;
  const file = envFilePath(serverRoot, 'test');
  let parsed: Record<string, string>;
  try {
    parsed = parse(readFileSync(file));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read DATABASE_URL from ${file}: ${message}`);
  }
  const url = parsed.DATABASE_URL?.trim();
  if (!url) throw new Error(`DATABASE_URL is missing from ${file}`);
  cachedTestDatabaseUrl = url;
  return url;
}

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const base = loadConfig({
    DATABASE_URL: testDatabaseUrl(),
    ENCRYPTION_KEY: 'test-encryption-key',
  });
  return {
    ...base,
    MEILI_URL: '',
    MEILI_API_KEY: '',
    QDRANT_URL: '',
    QDRANT_API_KEY: '',
    EMBEDDING_API_KEY: '',
    PUBLIC_BASE_URL: 'http://127.0.0.1:8787',
    COOKIE_SECURE: 'false',
    ...overrides,
  };
}

const schemas = new Map<string, { schema: string; databaseUrl: string }>();

export function schemaFor(dataDir: string, databaseUrl = testDatabaseUrl()): string {
  const existing = schemas.get(dataDir);
  if (existing) {
    if (existing.databaseUrl !== databaseUrl) {
      throw new Error('data dir is already bound to a different database');
    }
    return existing.schema;
  }
  const schema = createSchemaName();
  schemas.set(dataDir, { schema, databaseUrl });
  return schema;
}

export async function makeDataDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'agent-recall-'));
}

export async function openTestApp(options: {
  dataDir: string;
  config?: AppConfig;
  retrieval?: RetrievalPorts;
}): Promise<FastifyInstance> {
  const config = options.config ?? testConfig();
  const databaseUrl = config.DATABASE_URL;
  return buildApp({
    config,
    databaseUrl,
    schema: schemaFor(options.dataDir, databaseUrl),
    retrieval: options.retrieval,
    webDist: null,
    logger: false,
  });
}

export async function removeDataDir(dataDir: string): Promise<void> {
  if (!dataDir) throw new Error('refusing to remove an empty data dir');
  const bound = schemas.get(dataDir);
  if (bound) {
    await dropSchema(bound.databaseUrl, bound.schema);
    schemas.delete(dataDir);
  }
  await rm(dataDir, { recursive: true, force: true });
}

export interface CallResult {
  status: number;
  body: Record<string, unknown> | null;
  headers: Record<string, unknown>;
}

export async function call(
  app: FastifyInstance,
  method: string,
  url: string,
  options: { cookie?: string; token?: string; payload?: unknown } = {},
): Promise<CallResult> {
  const headers: Record<string, string> = {};
  if (options.cookie) headers.cookie = `ar_session=${options.cookie}`;
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  const methodName = method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  const inject = app.inject.bind(app) as (opts: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    url: string;
    headers: Record<string, string>;
    payload?: string | Record<string, unknown>;
  }) => Promise<{ statusCode: number; body: string; headers: Record<string, unknown> }>;
  const res = await inject({
    method: methodName,
    url,
    headers,
    ...(options.payload === undefined
      ? {}
      : { payload: options.payload as string | Record<string, unknown> }),
  });
  const body = res.body ? (JSON.parse(res.body) as Record<string, unknown>) : null;
  return { status: res.statusCode, body, headers: res.headers };
}

export function sessionCookie(headers: Record<string, unknown>): string {
  const raw = headers['set-cookie'];
  const line = Array.isArray(raw) ? raw.join(';') : String(raw ?? '');
  const match = /ar_session=([^;]+)/.exec(line);
  if (!match?.[1]) throw new Error(`missing session cookie: ${line}`);
  return match[1];
}
