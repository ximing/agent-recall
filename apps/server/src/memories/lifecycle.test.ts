import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRetrieval } from '../retrieval/ports.js';
import { startProtocolStandin, type ProtocolStandIn } from '../retrieval/protocol-standin.js';
import { call, makeDataDir, openTestApp, removeDataDir, sessionCookie, testConfig } from '../test/app-harness.js';

describe('memory lifecycle, governance, and hooks context', () => {
  let dataDir = '';
  let app: FastifyInstance;
  let standin: ProtocolStandIn;
  let cookie = '';
  let token = '';

  beforeAll(async () => {
    standin = await startProtocolStandin();
    dataDir = await makeDataDir();
    const config = testConfig({
      MEILI_URL: standin.url,
      MEILI_API_KEY: 'meili-test',
      QDRANT_URL: standin.url,
      QDRANT_API_KEY: 'qdrant-test',
      EMBEDDING_API_KEY: 'dash-test',
      EMBEDDING_BASE_URL: standin.url,
      EMBEDDING_DIMENSIONS: 8,
    });
    app = await openTestApp({ dataDir, config, retrieval: createRetrieval(config) });
    const registered = await call(app, 'POST', '/api/auth/register', {
      payload: { email: 'life@example.com', password: 'password-life' },
    });
    cookie = sessionCookie(registered.headers);
    const created = await call(app, 'POST', '/api/tokens', { cookie, payload: { name: 'agents' } });
    token = String(created.body?.secret);
  });

  afterAll(async () => {
    await app.close();
    await standin.close();
    await removeDataDir(dataDir);
  });

  it('dedupes repeated content within the window and keeps eventId idempotent', async () => {
    const first = await call(app, 'POST', '/api/memories', {
      token,
      payload: { content: '重复内容-窗口去重', type: 'preference', tags: ['test'] },
    });
    expect(first.status).toBe(201);
    const second = await call(app, 'POST', '/api/memories', {
      token,
      payload: { content: '重复内容-窗口去重' },
    });
    expect(second.status).toBe(200);
    expect(second.body?.deduped).toBe(true);

    const hookPayload = {
      eventId: 'sess-x:evt-0000001',
      hook: 'PostToolUse',
      content: '工具观察：修改了检索融合权重，RRF k 从 40 调到 60',
      sessionId: 'sess-x',
      project: 'agent-recall',
      toolName: 'Edit',
    };
    const a = await call(app, 'POST', '/api/hooks/events', { token, payload: hookPayload });
    const b = await call(app, 'POST', '/api/hooks/events', { token, payload: hookPayload });
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    const hookMemory = a.body?.memory as { origin: string; sessionId: string; project: string };
    expect(hookMemory.origin).toBe('hook');
    expect(hookMemory.sessionId).toBe('sess-x');
  });

  it('filters noise observations and redacts secrets before storing', async () => {
    const noise = await call(app, 'POST', '/api/hooks/events', {
      token,
      payload: { eventId: 'sess-x:evt-noise01', hook: 'PostToolUse', content: '{"tool":"TodoWrite"}', toolName: 'TodoWrite' },
    });
    expect(noise.status).toBe(202);

    const leaked = await call(app, 'POST', '/api/hooks/events', {
      token,
      payload: {
        eventId: 'sess-x:evt-secret1',
        hook: 'PostToolUse',
        content: '配置更新：api_key = sk-abcdef0123456789abcdef0123456789 已写入，数据库 postgres://user:passw0rd@db.internal:5432/app',
        toolName: 'Bash',
      },
    });
    expect(leaked.status).toBe(201);
    const stored = leaked.body?.memory as { content: string };
    expect(stored.content).not.toContain('sk-abcdef0123456789');
    expect(stored.content).not.toContain('passw0rd');
    expect(stored.content).toContain('[REDACTED');
  });

  it('injects formatted context within the token budget and excludes raw hook fragments', async () => {
    await call(app, 'POST', '/api/memories', {
      token,
      payload: { content: '项目约定：检索融合用 RRF，k=60', type: 'architecture', project: 'agent-recall' },
    });
    const ctx = await call(app, 'POST', '/api/hooks/context', {
      token,
      payload: { query: 'RRF 融合权重', tokenBudget: 500, project: 'agent-recall' },
    });
    expect(ctx.status).toBe(200);
    const context = String(ctx.body?.context ?? '');
    expect(context).toContain('相关记忆');
    expect(context).toContain('RRF');
    // hook 原始碎片不参与注入
    expect(context).not.toContain('工具观察');
    // 预算裁剪：注入文本不超预算（500 token ≈ 2000 字符）
    expect(context.length).toBeLessThanOrEqual(2000);

    const forbidden = await call(app, 'POST', '/api/hooks/context', { cookie, payload: { query: 'RRF' } });
    expect(forbidden.status).toBe(403);

    const preview = await call(app, 'POST', '/api/memories/context', {
      cookie,
      payload: { query: 'RRF 融合权重', tokenBudget: 500, project: 'agent-recall' },
    });
    expect(preview.status).toBe(200);
    expect(String(preview.body?.context ?? '')).toContain('RRF');
  });

  it('summarizes a session on SessionEnd and lists sessions', async () => {
    const end = await call(app, 'POST', '/api/hooks/events', {
      token,
      payload: {
        eventId: 'sess-x:evt-end0001',
        hook: 'SessionEnd',
        content: '会话结束：sess-x',
        sessionId: 'sess-x',
        project: 'agent-recall',
      },
    });
    expect(end.status).toBe(201);

    const sessions = await call(app, 'GET', '/api/sessions', { token });
    const list = sessions.body?.sessions as Array<{ sessionId: string; memoryCount: number }>;
    const sess = list.find((s) => s.sessionId === 'sess-x');
    expect(sess).toBeTruthy();
    expect(sess!.memoryCount).toBeGreaterThanOrEqual(2);

    const timeline = await call(app, 'GET', '/api/sessions/sess-x', { token });
    const items = timeline.body?.memories as Array<{ origin: string; content: string }>;
    const summary = items.find((m) => m.origin === 'summary');
    expect(summary).toBeTruthy();
    expect(summary!.content).toContain('会话摘要');
    expect(summary!.content).toContain('sess-x');

    // 重复 SessionEnd 幂等：摘要不重复生成
    await call(app, 'POST', '/api/hooks/events', {
      token,
      payload: {
        eventId: 'sess-x:evt-end0002',
        hook: 'SessionEnd',
        content: '会话结束：sess-x（重复）',
        sessionId: 'sess-x',
        project: 'agent-recall',
      },
    });
    const again = await call(app, 'GET', '/api/sessions/sess-x', { token });
    const summaries = (again.body?.memories as Array<{ origin: string }>).filter((m) => m.origin === 'summary');
    expect(summaries).toHaveLength(1);
  });

  it('batch-forgets with dryRun, and auto-forgets expired and stale fragments', async () => {
    for (const content of ['批删目标-甲', '批删目标-乙']) {
      await call(app, 'POST', '/api/memories', { token, payload: { content, tags: ['sweep'] } });
    }
    const dry = await call(app, 'POST', '/api/memories/batch-forget', {
      token,
      payload: { filter: { tags: ['sweep'] }, dryRun: true },
    });
    expect((dry.body as { matched: number }).matched).toBe(2);
    const real = await call(app, 'POST', '/api/memories/batch-forget', {
      token,
      payload: { filter: { tags: ['sweep'] } },
    });
    expect((real.body as { deleted: number }).deleted).toBe(2);
    const listed = await call(app, 'GET', '/api/memories', { token });
    expect(JSON.stringify(listed.body)).not.toContain('批删目标');

    // 过期记忆
    await call(app, 'POST', '/api/memories', {
      token,
      payload: { content: '临时记忆-已过期', expiresAt: new Date(Date.now() - 1000).toISOString() },
    });
    // 开启自动遗忘阈值后，过期记忆被清除
    await call(app, 'PUT', '/api/settings', { cookie, payload: { rerankEnabled: false, autoForgetDays: 30 } });
    const forget = await call(app, 'POST', '/api/memories/auto-forget', { token, payload: {} });
    const result = forget.body as { expired: number; deleted: number };
    expect(result.expired).toBeGreaterThanOrEqual(1);
    expect(result.deleted).toBeGreaterThanOrEqual(1);
    const after = await call(app, 'GET', '/api/memories?includeExpired=true', { token });
    expect(JSON.stringify(after.body)).not.toContain('临时记忆-已过期');
  });

  it('exports and imports memories with skip and replace strategies', async () => {
    const exported = await call(app, 'GET', '/api/memories/export', { token });
    expect(exported.status).toBe(200);
    const dump = exported.body as { format: string; memories: Array<{ id: string; content: string }> };
    expect(dump.format).toBe('agent-recall/v1');
    expect(dump.memories.length).toBeGreaterThan(0);

    // skip：全部已存在 → 全部跳过
    const skip = await call(app, 'POST', '/api/memories/import', {
      token,
      payload: { memories: dump.memories, strategy: 'skip' },
    });
    expect((skip.body as { skipped: number }).skipped).toBe(dump.memories.length);

    // replace：同 id 覆盖内容
    const target = dump.memories.find((m) => m.content.includes('重复内容-窗口去重'))!;
    const replaced = await call(app, 'POST', '/api/memories/import', {
      token,
      payload: { memories: [{ ...target, content: '重复内容-窗口去重（导入覆盖）' }], strategy: 'replace' },
    });
    expect((replaced.body as { replaced: number }).replaced).toBe(1);
    const fetched = await call(app, 'GET', `/api/memories/${target.id}`, { token });
    expect((fetched.body?.memory as { content: string }).content).toContain('导入覆盖');

    // 新行导入
    const fresh = await call(app, 'POST', '/api/memories/import', {
      token,
      payload: { memories: [{ content: '导入的新记忆', type: 'lesson', tags: ['imported'] }] },
    });
    expect((fresh.body as { imported: number }).imported).toBe(1);
  });

  it('reports stats and returns scores from smart-search', async () => {
    const stats = await call(app, 'GET', '/api/memories/stats', { token });
    const body = stats.body?.stats as { total: number; byOrigin: Record<string, number>; sessions: number };
    expect(body.total).toBeGreaterThan(0);
    expect(body.byOrigin.hook).toBeGreaterThanOrEqual(1);
    expect(body.sessions).toBeGreaterThanOrEqual(1);

    const smart = await call(app, 'POST', '/api/memories/smart-search', {
      token,
      payload: { query: 'RRF 融合' },
    });
    expect(smart.status).toBe(200);
    expect(smart.body).toHaveProperty('scores');
    expect(smart.body).toHaveProperty('strategy');
  });
});
