import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startProtocolStandin, type ProtocolStandIn } from '../src/retrieval/protocol-standin.js';

export const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const mcpRoot = path.resolve(serverRoot, '../mcp');

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
  dataDir: string;
  standin: ProtocolStandIn;
  webDist?: string;
}): ChildProcess {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(options.port),
    HOST: '127.0.0.1',
    DATA_DIR: options.dataDir,
    DATABASE_URL: '',
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
