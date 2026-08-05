import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, makeDataDir, openTestApp, removeDataDir, sessionCookie, testConfig } from '../test/app-harness.js';

describe('accounts, memories, and tokens', () => {
  let dataDir = '';
  let app: FastifyInstance;

  beforeAll(async () => {
    dataDir = await makeDataDir();
    app = await openTestApp({ dataDir, config: testConfig({ dataDir }) });
  });

  afterAll(async () => {
    await app.close();
    await removeDataDir(dataDir);
  });

  it('keeps web and agent memories private, editable, and durable', async () => {
    const health = await call(app, 'GET', '/health');
    expect(health.body).toEqual({ ok: true });

    const registered = await call(app, 'POST', '/api/auth/register', {
      payload: { email: 'ada@example.com', password: 'password-ada' },
    });
    expect(registered.status).toBe(201);
    const cookie = sessionCookie(registered.headers);

    const web = await call(app, 'POST', '/api/memories', {
      cookie,
      payload: { content: '网页记忆-海盐' },
    });
    expect(web.status).toBe(201);
    const webMemory = web.body?.memory as { id: string; content: string; origin: string };
    expect(webMemory.content).toBe('网页记忆-海盐');
    expect(webMemory.origin).toBe('web');

    const token = await call(app, 'POST', '/api/tokens', { cookie, payload: { name: '代理' } });
    expect(token.status).toBe(201);
    const secret = String(token.body?.secret);
    const preview = (token.body?.token as { preview: string }).preview;
    expect(preview).not.toBe(secret);
    expect(secret.startsWith('arm_')).toBe(true);

    const listedTokens = await call(app, 'GET', '/api/tokens', { cookie });
    const tokenJson = JSON.stringify(listedTokens.body);
    expect(tokenJson).not.toContain(secret);
    expect(tokenJson).toContain(preview);

    const agent = await call(app, 'POST', '/api/memories', {
      token: secret,
      payload: { content: '代理记忆-松烟' },
    });
    expect(agent.status).toBe(201);
    expect((agent.body?.memory as { origin: string }).origin).toBe('agent');
    expect((agent.body?.memory as { content: string }).content).toBe('代理记忆-松烟');

    const edited = await call(app, 'PATCH', `/api/memories/${webMemory.id}`, {
      cookie,
      payload: { content: '网页记忆-海盐-改' },
    });
    expect((edited.body?.memory as { content: string }).content).toBe('网页记忆-海盐-改');
    const fetched = await call(app, 'GET', `/api/memories/${webMemory.id}`, { cookie });
    expect((fetched.body?.memory as { content: string }).content).toBe('网页记忆-海盐-改');

    const other = await call(app, 'POST', '/api/auth/register', {
      payload: { email: 'bea@example.com', password: 'password-bea' },
    });
    const otherCookie = sessionCookie(other.headers);
    const otherList = await call(app, 'GET', '/api/memories', { cookie: otherCookie });
    expect(JSON.stringify(otherList.body)).not.toContain('海盐');
    expect(JSON.stringify(otherList.body)).not.toContain('松烟');
    expect((await call(app, 'GET', `/api/memories/${webMemory.id}`, { cookie: otherCookie })).status).toBe(404);
    expect(
      (await call(app, 'PATCH', `/api/memories/${webMemory.id}`, { cookie: otherCookie, payload: { content: '偷改' } }))
        .status,
    ).toBe(404);
    expect((await call(app, 'DELETE', `/api/memories/${webMemory.id}`, { cookie: otherCookie })).status).toBe(404);
    const otherRecall = await call(app, 'POST', '/api/memories/recall', {
      cookie: otherCookie,
      payload: { query: '海盐' },
    });
    expect(JSON.stringify(otherRecall.body)).not.toContain('海盐');

    expect((await call(app, 'DELETE', `/api/memories/${webMemory.id}`, { cookie })).status).toBe(204);
    const afterDelete = await call(app, 'GET', '/api/memories', { cookie });
    expect(JSON.stringify(afterDelete.body)).not.toContain('海盐');
    expect(JSON.stringify(afterDelete.body)).toContain('代理记忆-松烟');

    const tokenId = (token.body?.token as { id: string }).id;
    const revoked = await call(app, 'POST', `/api/tokens/${tokenId}/revoke`, { cookie });
    expect((revoked.body?.token as { revokedAt: string | null }).revokedAt).toBeTruthy();
    expect((await call(app, 'POST', '/api/memories', { token: secret, payload: { content: '不该写入' } })).status).toBe(
      401,
    );
    expect((await call(app, 'POST', '/api/memories/recall', { token: secret, payload: { query: '松烟' } })).status).toBe(
      401,
    );

    const mcp = await call(app, 'POST', '/api/mcp/clients', { cookie, payload: { name: 'claude' } });
    expect(mcp.status).toBe(201);
    const mcpSecret = String(mcp.body?.secret);
    const configText = String(mcp.body?.config);
    expect(configText).toContain('http://127.0.0.1:8787');
    expect(configText).toContain(mcpSecret);
    const mcpList = await call(app, 'GET', '/api/mcp/clients', { cookie });
    expect(JSON.stringify(mcpList.body)).not.toContain(mcpSecret);
    expect(JSON.stringify(mcpList.body)).toContain((mcp.body?.client as { tokenPreview: string }).tokenPreview);
    const mcpClientId = (mcp.body?.client as { id: string }).id;
    expect((await call(app, 'POST', '/api/memories', { token: mcpSecret, payload: { content: 'MCP记忆-青瓷' } })).status).toBe(
      201,
    );
    expect((await call(app, 'POST', `/api/mcp/clients/${mcpClientId}/revoke`, { cookie })).status).toBe(200);
    expect((await call(app, 'POST', '/api/memories', { token: mcpSecret, payload: { content: '吊销后' } })).status).toBe(
      401,
    );
    expect(
      (await call(app, 'POST', '/api/memories/smart-search', { token: mcpSecret, payload: { query: '青瓷' } })).status,
    ).toBe(401);

    await app.close();
    app = await openTestApp({ dataDir, config: testConfig({ dataDir }) });
    const relogin = await call(app, 'POST', '/api/auth/login', {
      payload: { email: 'ada@example.com', password: 'password-ada' },
    });
    expect(relogin.status).toBe(200);
    const again = await call(app, 'GET', '/api/memories', { cookie: sessionCookie(relogin.headers) });
    expect(JSON.stringify(again.body)).toContain('代理记忆-松烟');
    expect(JSON.stringify(again.body)).toContain('MCP记忆-青瓷');
  });
});
