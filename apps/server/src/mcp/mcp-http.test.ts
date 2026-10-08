import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, makeDataDir, openTestApp, removeDataDir, sessionCookie } from '../test/app-harness.js';

describe('remote mcp', () => {
  let dataDir = '';
  let app: FastifyInstance;
  let token = '';
  let cookie = '';

  beforeAll(async () => {
    dataDir = await makeDataDir();
    app = await openTestApp({ dataDir });
    const registered = await call(app, 'POST', '/api/auth/register', {
      payload: { email: 'mcp-http@example.com', password: 'password-mcp' },
    });
    cookie = sessionCookie(registered.headers);
    const created = await call(app, 'POST', '/api/tokens', { cookie, payload: { name: 'remote' } });
    token = String(created.body?.secret);
  });

  afterAll(async () => {
    await app.close();
    await removeDataDir(dataDir);
  });

  function post(body: unknown, extra: { url?: string; headers?: Record<string, string> } = {}) {
    return app.inject({
      method: 'POST',
      url: extra.url ?? '/mcp',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...extra.headers,
      },
      payload: body as never,
    });
  }

  it('speaks stateless JSON-RPC and omits local file tools', async () => {
    const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
    expect(init.statusCode).toBe(200);
    const initBody = init.json() as { result: { protocolVersion: string; serverInfo: { name: string } } };
    expect(initBody.result.protocolVersion).toBe('2025-03-26');
    expect(initBody.result.serverInfo.name).toBe('agent-recall');
    expect(init.headers['mcp-session-id']).toBeUndefined();

    const unknown = await post({ jsonrpc: '2.0', id: 'x', method: 'initialize', params: { protocolVersion: '1999-01-01' } });
    expect((unknown.json() as { result: { protocolVersion: string } }).result.protocolVersion).toBe('2025-11-25');

    const listed = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const tools = (listed.json() as { result: { tools: Array<{ name: string }> } }).result.tools;
    expect(tools).toHaveLength(62);
    expect(tools.map((tool) => tool.name)).not.toEqual(expect.arrayContaining([
      'memory_compress_file',
      'memory_claude_bridge_sync',
      'memory_obsidian_export',
    ]));

    const core = await post({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, { url: '/mcp?profile=core' });
    expect((core.json() as { result: { tools: unknown[] } }).result.tools).toHaveLength(12);

    const ping = await post({ jsonrpc: '2.0', id: 4, method: 'ping' });
    expect(ping.json()).toEqual({ jsonrpc: '2.0', id: 4, result: {} });

    const saved = await post({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'memory_save', arguments: { content: '远程 MCP 写入-青瓷' } },
    });
    expect(saved.statusCode).toBe(200);
    expect((saved.json() as { result: { content: Array<{ text: string }> } }).result.content[0]?.text).toContain('远程 MCP 写入-青瓷');

    const local = await post({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'memory_compress_file', arguments: { path: '/tmp/nope' } },
    });
    const localBody = local.json() as { result: { isError: boolean; content: Array<{ text: string }> } };
    expect(localBody.result.isError).toBe(true);
    expect(localBody.result.content[0]?.text).toContain('Unknown tool');

    const note = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(note.statusCode).toBe(202);
    expect(note.body).toBe('');

    const batch = await post([{ jsonrpc: '2.0', id: 1, method: 'ping' }]);
    expect(batch.statusCode).toBe(400);
    expect((batch.json() as { error: { code: number } }).error.code).toBe(-32600);

    const missing = await post({ jsonrpc: '2.0', id: 7, method: 'resources/list' });
    expect((missing.json() as { error: { code: number } }).error.code).toBe(-32601);
  });

  it('refuses session cookies, GET, and DELETE', async () => {
    const cookieOnly = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { cookie: `ar_session=${cookie}`, 'content-type': 'application/json' },
      payload: { jsonrpc: '2.0', id: 1, method: 'ping' },
    });
    expect(cookieOnly.statusCode).toBe(401);
    expect((cookieOnly.json() as { error: { message: string } }).error.message).toBe('Unauthorized');

    const get = await app.inject({ method: 'GET', url: '/mcp' });
    expect(get.statusCode).toBe(405);
    expect(String(get.headers.allow)).toContain('POST');

    const del = await app.inject({ method: 'DELETE', url: '/mcp' });
    expect(del.statusCode).toBe(405);
  });

  it('answers a single SSE event when the client only accepts event-stream', async () => {
    const res = await post(
      { jsonrpc: '2.0', id: 9, method: 'ping' },
      { headers: { accept: 'text/event-stream' } },
    );
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['content-type'])).toContain('text/event-stream');
    expect(res.body).toContain('event: message');
    expect(res.body).toContain('"result":{}');
  });
});
