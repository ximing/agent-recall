import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { loadConfig, type AppConfig } from '../config.js';
import type { RetrievalPorts } from '../retrieval/ports.js';

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const base = loadConfig({});
  return {
    ...base,
    DATABASE_URL: undefined,
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

export async function makeDataDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'agent-recall-'));
}

export async function openTestApp(options: {
  dataDir: string;
  config?: AppConfig;
  retrieval?: RetrievalPorts;
}): Promise<FastifyInstance> {
  const config = options.config ?? testConfig({ dataDir: options.dataDir });
  return buildApp({
    config: { ...config, dataDir: options.dataDir },
    dataDir: options.dataDir,
    databaseUrl: null,
    retrieval: options.retrieval,
    webDist: null,
    logger: false,
  });
}

export async function removeDataDir(dataDir: string): Promise<void> {
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
  const methodName = method as 'GET' | 'POST' | 'PATCH' | 'DELETE';
  const inject = app.inject.bind(app) as (opts: {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
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
