import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recallLogs } from '../db/schema.js';
import { createEmbeddingClient } from './embedding.js';
import { createRetrieval } from './ports.js';
import { embedDeterministic, startProtocolStandin, type ProtocolStandIn } from './protocol-standin.js';
import { call, makeDataDir, openTestApp, removeDataDir, sessionCookie, testConfig } from '../test/app-harness.js';

describe('two-path recall', () => {
  let dataDir = '';
  let app: FastifyInstance;
  let standin: ProtocolStandIn;
  let cookie = '';
  let userId = '';

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
      EMBEDDING_MODEL: 'qwen3-vl-embedding',
      EMBEDDING_DIMENSIONS: 8,
    });
    app = await openTestApp({ dataDir, config, retrieval: createRetrieval(config) });
    const registered = await call(app, 'POST', '/api/auth/register', {
      payload: { email: 'recall@example.com', password: 'password-recall' },
    });
    cookie = sessionCookie(registered.headers);
    userId = (registered.body?.user as { id: string }).id;
  });

  afterAll(async () => {
    await app.close();
    await standin.close();
    await removeDataDir(dataDir);
  });

  async function create(content: string, authCookie = cookie): Promise<{ id: string; content: string }> {
    const res = await call(app, 'POST', '/api/memories', { cookie: authCookie, payload: { content } });
    expect(res.status).toBe(201);
    return res.body?.memory as { id: string; content: string };
  }

  it('parses DashScope multimodal embeddings in index order', async () => {
    standin.control.reverseIndexes = true;
    const client = createEmbeddingClient({
      apiKey: 'dash-test',
      baseUrl: standin.url,
      model: 'qwen3-vl-embedding',
      dimensions: 8,
    });
    const vectors = await client.embedTexts(['甲', '乙']);
    expect(vectors[0]).toEqual(embedDeterministic('甲', 8));
    expect(vectors[1]).toEqual(embedDeterministic('乙', 8));
    const recorded = standin.control.embeddingRequests.at(-1);
    expect(recorded?.url).toBe('/services/embeddings/multimodal-embedding/multimodal-embedding');
    expect(recorded?.authorization).toBe('Bearer dash-test');
    expect(recorded?.body).toMatchObject({
      model: 'qwen3-vl-embedding',
      input: { contents: [{ text: '甲' }, { text: '乙' }] },
      parameters: { dimension: 8 },
    });
    standin.control.reverseIndexes = false;
  });

  it('fuses a lexical-only hit and a vector-only hit and drops another user', async () => {
    const lexical = await create('仅词法可见的梅');
    const vector = await create('仅向量可见的兰');
    const otherUser = await call(app, 'POST', '/api/auth/register', {
      payload: { email: 'other@example.com', password: 'password-other' },
    });
    const other = await create('别人的荷', sessionCookie(otherUser.headers));
    standin.control.script = { meiliIds: [lexical.id], qdrantIds: [vector.id, other.id] };

    const recalled = await call(app, 'POST', '/api/memories/recall', { cookie, payload: { query: '路径' } });
    const contents = ((recalled.body?.memories as { content: string }[]) ?? []).map((item) => item.content);
    expect(contents).toContain('仅词法可见的梅');
    expect(contents).toContain('仅向量可见的兰');
    expect(contents).not.toContain('别人的荷');

    const meiliBody = standin.control.meiliSearches.at(-1) as { filter?: string };
    const qdrantBody = standin.control.qdrantQueries.at(-1) as { filter?: { must?: { match?: { value?: string } }[] } };
    expect(meiliBody.filter).toContain(userId);
    expect(qdrantBody.filter?.must?.[0]?.match?.value).toBe(userId);
    expect(JSON.stringify(standin.control.settings)).toContain('cmn');

    standin.control.script = { meiliStatus: 500, qdrantIds: [vector.id] };
    const degraded = await call(app, 'POST', '/api/memories/smart-search', { cookie, payload: { query: '路径' } });
    expect((degraded.body?.memories as { content: string }[]).map((item) => item.content)).toEqual(['仅向量可见的兰']);
    standin.control.script = null;
  });

  it('ranks with reciprocal rank fusion at k=60', async () => {
    const top = await create('词法榜首的松');
    const mid = await create('两路中位的竹');
    const lexicalPads = Array.from({ length: 28 }, () => randomUUID());
    const vectorPads = Array.from({ length: 29 }, () => randomUUID());
    standin.control.script = {
      meiliIds: [top.id, ...lexicalPads, mid.id],
      qdrantIds: [...vectorPads, mid.id],
    };
    const recalled = await call(app, 'POST', '/api/memories/recall', { cookie, payload: { query: '融合' } });
    const contents = ((recalled.body?.memories as { content: string }[]) ?? []).map((item) => item.content);
    expect(contents[0]).toBe('两路中位的竹');
    expect(contents[1]).toBe('词法榜首的松');
    standin.control.script = null;
  });

  it('keeps the memory when indexing fails and recalls it after a later index', async () => {
    standin.control.failWrites = true;
    standin.control.script = null;
    const created = await create('稍后才能召回的桂花');
    const listed = await call(app, 'GET', '/api/memories', { cookie });
    expect(JSON.stringify(listed.body)).toContain('稍后才能召回的桂花');
    const missed = await call(app, 'POST', '/api/memories/recall', { cookie, payload: { query: '桂花' } });
    expect((missed.body?.memories as { content: string }[]).map((item) => item.content)).not.toContain(
      '稍后才能召回的桂花',
    );

    standin.control.failWrites = false;
    const found = await call(app, 'POST', '/api/memories/smart-search', { cookie, payload: { query: '桂花' } });
    const hit = (found.body?.memories as { id: string; content: string }[]).find((item) => item.id === created.id);
    expect(hit?.content).toBe('稍后才能召回的桂花');
  });

  it('reranks fused candidates only when enabled in settings, and falls back to RRF on failure', async () => {
    const defaults = await call(app, 'GET', '/api/settings', { cookie });
    expect(defaults.body?.settings).toMatchObject({
      rerankEnabled: false,
      rerankModel: 'gte-rerank-v2',
      hasRerankApiKey: false,
    });

    const pine = await create('精排后置的松');
    const plum = await create('精排前置的梅');
    standin.control.script = { meiliIds: [pine.id, plum.id], qdrantIds: [], rerankOrder: [1, 0] };

    // 未启用：不发 rerank 请求，保持 RRF 顺序
    const before = standin.control.rerankRequests.length;
    const plain = await call(app, 'POST', '/api/memories/recall', { cookie, payload: { query: '精排' } });
    expect(standin.control.rerankRequests.length).toBe(before);
    expect((plain.body?.memories as { id: string }[]).map((item) => item.id)).toEqual([pine.id, plum.id]);

    // 启用 rerank：候选顺序按精排结果翻转，请求带 model 和 Bearer key
    const saved = await call(app, 'PUT', '/api/settings', {
      cookie,
      payload: {
        rerankEnabled: true,
        rerankBaseUrl: standin.url,
        rerankModel: 'gte-rerank-v2',
        rerankApiKey: 'rk-test-secret',
      },
    });
    expect(saved.status).toBe(200);
    expect(saved.body?.settings).toMatchObject({ hasRerankApiKey: true, rerankApiKeyPreview: 'rk-tes…' });

    const reranked = await call(app, 'POST', '/api/memories/recall', { cookie, payload: { query: '精排' } });
    expect((reranked.body?.memories as { id: string }[]).map((item) => item.id)).toEqual([plum.id, pine.id]);
    const recorded = standin.control.rerankRequests.at(-1);
    expect(recorded?.url).toBe('/services/rerank/text-rerank/text-rerank');
    expect(recorded?.authorization).toBe('Bearer rk-test-secret');
    expect(recorded?.body).toMatchObject({ model: 'gte-rerank-v2' });

    // 精排失败：接口不挂，回退 RRF 顺序
    standin.control.script = { meiliIds: [pine.id, plum.id], qdrantIds: [], rerankStatus: 500 };
    const degraded = await call(app, 'POST', '/api/memories/recall', { cookie, payload: { query: '精排' } });
    expect(degraded.status).toBe(200);
    expect((degraded.body?.memories as { id: string }[]).map((item) => item.id)).toEqual([pine.id, plum.id]);

    await call(app, 'PUT', '/api/settings', { cookie, payload: { rerankEnabled: false, rerankApiKey: '' } });
    const cleared = await call(app, 'GET', '/api/settings', { cookie });
    expect(cleared.body?.settings).toMatchObject({ rerankEnabled: false, hasRerankApiKey: false });
    standin.control.script = null;
  });

  it('records recall history with strategy, and sweeps entries older than 30 days', async () => {
    // 埋一条 31 天前的旧日志，验证滚动清理
    const staleId = randomUUID();
    await app.ctx.db.insert(recallLogs).values({
      id: staleId,
      userId,
      query: '过期查询',
      strategy: 'rrf',
      rerankModel: null,
      rerankApplied: false,
      results: [],
      latencyMs: 1,
      createdAt: new Date(Date.now() - 31 * 24 * 3600 * 1000),
    });

    await call(app, 'POST', '/api/memories/recall', { cookie, payload: { query: '历史沉淀测试' } });
    const listed = await call(app, 'GET', '/api/memories/recall-logs', { cookie });
    const logs = (listed.body?.logs ?? []) as { id: string; query: string; strategy: string; rerankApplied: boolean }[];
    const latest = logs[0];
    expect(latest?.query).toBe('历史沉淀测试');
    expect(latest?.strategy).toBe('rrf');
    expect(latest?.rerankApplied).toBe(false);
    expect(logs.some((log) => log.id === staleId)).toBe(false);

    // 启用精排后，策略、生效标记与分数都应体现在日志里
    await call(app, 'PUT', '/api/settings', {
      cookie,
      payload: { rerankEnabled: true, rerankBaseUrl: standin.url, rerankApiKey: 'rk-log-test' },
    });
    standin.control.script = { rerankOrder: undefined };
    await call(app, 'POST', '/api/memories/recall', { cookie, payload: { query: '精排日志' } });
    const after = await call(app, 'GET', '/api/memories/recall-logs', { cookie });
    const rerankedLog = (
      after.body?.logs as {
        query: string;
        strategy: string;
        rerankApplied: boolean;
        rerankModel: string | null;
        rerankError: string | null;
        results: { score: number | null }[];
      }[]
    )[0];
    expect(rerankedLog?.query).toBe('精排日志');
    expect(rerankedLog?.strategy).toBe('rrf+rerank');
    expect(rerankedLog?.rerankModel).toBe('gte-rerank-v2');
    expect(rerankedLog?.rerankError).toBeNull();
    expect(rerankedLog?.results.length).toBeGreaterThan(0);
    expect(rerankedLog?.results.every((result) => typeof result.score === 'number')).toBe(true);

    // 精排失败：日志记下失败原因，结果分数为空
    standin.control.script = { rerankStatus: 500 };
    await call(app, 'POST', '/api/memories/recall', { cookie, payload: { query: '精排失败日志' } });
    const failed = await call(app, 'GET', '/api/memories/recall-logs', { cookie });
    const failedLog = (
      failed.body?.logs as { query: string; rerankApplied: boolean; rerankError: string | null; results: { score: number | null }[] }[]
    )[0];
    expect(failedLog?.query).toBe('精排失败日志');
    expect(failedLog?.rerankApplied).toBe(false);
    expect(failedLog?.rerankError).toBe('rerank failed with status 500');
    expect(failedLog?.rerankError).not.toContain('127.0.0.1');
    expect(failedLog?.results.every((result) => result.score === null)).toBe(true);

    await call(app, 'PUT', '/api/settings', { cookie, payload: { rerankEnabled: false, rerankApiKey: '' } });
    standin.control.script = null;
  });
});
