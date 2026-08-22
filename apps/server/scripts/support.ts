import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import { envFilePath } from '../src/env.js';
import { startProtocolStandin, type ProtocolStandIn } from '../src/retrieval/protocol-standin.js';

export const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const mcpRoot = path.resolve(serverRoot, '../mcp');

/** Reads apps/server/.env.test only. A shell DATABASE_URL is ignored so launch scripts cannot hit production. */
export function launchDatabaseUrl(): string {
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
  return url;
}

export async function waitForHealth(base: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return;
    } catch {
      // The process is still booting.
    }
    if (Date.now() > deadline) throw new Error(`health check timed out for ${base}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

export function startServer(options: {
  port: number;
  databaseUrl: string;
  schema: string;
  standin: ProtocolStandIn;
  webDist?: string;
}): ChildProcess {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(options.port),
    HOST: '127.0.0.1',
    DATABASE_URL: options.databaseUrl,
    DATABASE_SCHEMA: options.schema,
    ENCRYPTION_KEY: 'launch-encryption-key',
    PUBLIC_BASE_URL: `http://127.0.0.1:${String(options.port)}`,
    WEB_ORIGIN: `http://127.0.0.1:${String(options.port)}`,
    MEILI_URL: options.standin.url,
    MEILI_API_KEY: 'launch-test',
    QDRANT_URL: options.standin.url,
    QDRANT_API_KEY: 'launch-test',
    EMBEDDING_API_KEY: 'launch-test',
    EMBEDDING_BASE_URL: options.standin.url,
    EMBEDDING_MODEL: 'qwen3-vl-embedding',
    EMBEDDING_DIMENSIONS: '8',
    COOKIE_SECURE: 'false',
    NODE_ENV: options.webDist ? 'production' : 'development',
  };
  if (options.webDist) env.WEB_DIST = options.webDist;
  else delete env.WEB_DIST;
  return spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: serverRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, 4000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export function sessionFrom(response: Response): string {
  const lines = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  const line = lines[0] ?? response.headers.get('set-cookie') ?? '';
  const match = /ar_session=([^;]+)/.exec(line);
  if (!match?.[1]) throw new Error(`missing session cookie: ${line}`);
  return match[1];
}

export async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) throw new Error(`${String(response.status)} ${text}`);
  return body;
}

export async function bootStandin(): Promise<ProtocolStandIn> {
  return startProtocolStandin();
}
