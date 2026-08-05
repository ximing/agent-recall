import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRetrieval } from '../retrieval/ports.js';
import { startProtocolStandin, type ProtocolStandIn } from '../retrieval/protocol-standin.js';
import { call, makeDataDir, openTestApp, removeDataDir, sessionCookie, testConfig } from '../test/app-harness.js';

const mcpRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../mcp');

interface RpcMessage {
  id?: number | string | null;
  result?: {
    protocolVersion?: string;
    tools?: { name: string; inputSchema?: { required?: string[] } }[];
    content?: { text?: string }[];
  };
  error?: { code?: number; message?: string };
}

function startMcp(url: string, token: string): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: mcpRoot,
    env: { ...process.env, AGENT_RECALL_URL: url, AGENT_RECALL_TOKEN: token },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function speak(child: ChildProcessWithoutNullStreams) {
  let buffer = '';
  const waiters: Array<(message: RpcMessage) => void> = [];
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    let index = buffer.indexOf('\n');
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf('\n');
      if (!line) continue;
      const waiter = waiters.shift();
      if (waiter) waiter(JSON.parse(line) as RpcMessage);
    }
  });
  let seq = 0;
  return {
    request(method: string, params: Record<string, unknown> = {}) {
      const id = ++seq;
      const message = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      const response = new Promise<RpcMessage>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 8000);
        waiters.push((value) => {
          clearTimeout(timer);
          resolve(value);
        });
      });
      child.stdin.write(`${message}\n`);
      return response;
    },
    notify(method: string) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
    },
  };
}

describe('mcp stdio', () => {
  let dataDir = '';
  let app: FastifyInstance;
  let standin: ProtocolStandIn;
  let base = '';
  let cookie = '';

  beforeAll(async () => {
    standin = await startProtocolStandin();
    dataDir = await makeDataDir();
    const config = testConfig({
      dataDir,
      MEILI_URL: standin.url,
      MEILI_API_KEY: 'meili-test',
      QDRANT_URL: standin.url,
      QDRANT_API_KEY: 'qdrant-test',
      EMBEDDING_API_KEY: 'dash-test',
      EMBEDDING_BASE_URL: standin.url,
      EMBEDDING_DIMENSIONS: 8,
    });
    app = await openTestApp({ dataDir, config, retrieval: createRetrieval(config) });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('server did not bind');
    base = `http://127.0.0.1:${String(address.port)}`;
    const registered = await call(app, 'POST', '/api/auth/register', {
      payload: { email: 'mcp@example.com', password: 'password-mcp' },
    });
    cookie = sessionCookie(registered.headers);
  });

  afterAll(async () => {
    await app.close();
    await standin.close();
    await removeDataDir(dataDir);
  });

  it('saves through memory_save and finds it with memory_smart_search, then rejects a revoked token', async () => {
    const created = await call(app, 'POST', '/api/tokens', { cookie, payload: { name: 'stdio' } });
    const secret = String(created.body?.secret);
    const tokenId = (created.body?.token as { id: string }).id;
    const child = startMcp(base, secret);
    const rpc = speak(child);
    try {
      const initialized = await rpc.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '0' },
      });
      expect(initialized.result?.protocolVersion ?? initialized.result).toBeTruthy();
      rpc.notify('notifications/initialized');
      const tools = await rpc.request('tools/list');
      const names = (tools.result?.tools ?? []).map((tool) => tool.name);
      expect(names).toEqual(expect.arrayContaining(['memory_save', 'memory_recall', 'memory_smart_search']));
      const saveTool = tools.result?.tools?.find((tool) => tool.name === 'memory_save');
      const recallTool = tools.result?.tools?.find((tool) => tool.name === 'memory_recall');
      const smartTool = tools.result?.tools?.find((tool) => tool.name === 'memory_smart_search');
      expect(saveTool?.inputSchema?.required).toContain('content');
      expect(recallTool?.inputSchema?.required).toContain('query');
      expect(smartTool?.inputSchema?.required).toContain('query');

      const saved = await rpc.request('tools/call', {
        name: 'memory_save',
        arguments: { content: 'MCP保存的星图' },
      });
      expect(saved.result?.content?.[0]?.text).toContain('MCP保存的星图');
      const searched = await rpc.request('tools/call', {
        name: 'memory_smart_search',
        arguments: { query: '星图' },
      });
      expect(searched.result?.content?.[0]?.text).toContain('MCP保存的星图');

      await call(app, 'POST', `/api/tokens/${tokenId}/revoke`, { cookie });
      const denied = await rpc.request('tools/call', {
        name: 'memory_recall',
        arguments: { query: '星图' },
      });
      expect(denied.error?.message).toBe('Unauthorized');
    } finally {
      child.kill('SIGTERM');
    }
  });
});
