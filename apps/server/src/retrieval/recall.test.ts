import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
      dataDir,
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
});
