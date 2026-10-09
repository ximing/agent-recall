import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { llmUsageListSchema } from '@agent-recall/dto';
import { eq } from 'drizzle-orm';
import { agentExecutions, llmUsageLogs } from '../db/schema.js';
import { chatCompletionsUrl, anthropicMessagesUrl, llmTransport } from './client.js';
import { estimateCost } from './pricing.js';
import { createRetrieval } from '../retrieval/ports.js';
import { startProtocolStandin, type ProtocolStandIn } from '../retrieval/protocol-standin.js';
import { call, makeDataDir, openTestApp, removeDataDir, sessionCookie, testConfig } from '../test/app-harness.js';

const originalFetch = llmTransport.fetch;

describe('llm pricing', () => {
  it('prices known chat models and embedding calls from a local table', () => {
    expect(estimateCost({ provider: 'openai', model: 'gpt-4o-mini', capability: 'chat', promptTokens: 1_000_000, completionTokens: 0 })).toBe(0.15);
    expect(estimateCost({ provider: 'openai', model: 'gpt-4o-mini', capability: 'chat', promptTokens: 0, completionTokens: 1_000_000 })).toBe(0.6);
    expect(estimateCost({ provider: 'dashscope', model: 'qwen3-vl-embedding', capability: 'embed', promptTokens: 1_000_000, completionTokens: 0 })).toBe(0.07);
    expect(chatCompletionsUrl('https://api.deepseek.com')).toBe('https://api.deepseek.com/chat/completions');
    expect(anthropicMessagesUrl('https://api.anthropic.com')).toBe('https://api.anthropic.com/v1/messages');
    expect(anthropicMessagesUrl('https://api.anthropic.com/v1')).toBe('https://api.anthropic.com/v1/messages');
  });
});

describe('llm configs, cost ledger, and semantic consolidate', () => {
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
      EMBEDDING_MODEL: 'qwen3-vl-embedding',
      EMBEDDING_DIMENSIONS: 8,
    });
    app = await openTestApp({ dataDir, config, retrieval: createRetrieval(config) });
    const registered = await call(app, 'POST', '/api/auth/register', {
      payload: { email: 'llm@example.com', password: 'password-llm' },
    });
    cookie = sessionCookie(registered.headers);
    const created = await call(app, 'POST', '/api/tokens', { cookie, payload: { name: 'llm' } });
    token = String(created.body?.secret);
  });

  afterAll(async () => {
    llmTransport.fetch = originalFetch;
    await app.close();
    await standin.close();
    await removeDataDir(dataDir);
  });

  beforeEach(() => {
    llmTransport.fetch = originalFetch;
  });

  it('stores an encrypted default model, hides the key, and records a failed test call', async () => {
    const apiKey = 'sk-test-secret-value-123456';
    const created = await call(app, 'POST', '/api/llm-configs', {
      cookie,
      payload: { provider: 'openai', model: 'gpt-4o-mini', apiKey },
    });
    expect(created.status).toBe(201);
    const config = created.body?.config as { id: string; isDefault: boolean; apiKeyPreview: string; baseUrl: string | null };
    expect(config.isDefault).toBe(true);
    expect(config.baseUrl).toBeNull();
    expect(config.apiKeyPreview.startsWith('sk-tes')).toBe(true);
    expect(JSON.stringify(created.body)).not.toContain(apiKey);

    const second = await call(app, 'POST', '/api/llm-configs', {
      cookie,
      payload: { provider: 'deepseek', model: 'deepseek-chat', apiKey: 'sk-second-key-abcdef123456' },
    });
    expect((second.body?.config as { isDefault: boolean }).isDefault).toBe(false);

    llmTransport.fetch = async () =>
      new Response(JSON.stringify({ error: { message: `bad key ${apiKey}` } }), { status: 401 });
    const tested = await call(app, 'POST', `/api/llm-configs/${config.id}/test`, { cookie, payload: {} });
    expect(tested.status).toBe(200);
    expect(tested.body?.ok).toBe(false);
    expect(JSON.stringify(tested.body)).not.toContain(apiKey);

    const usage = await call(app, 'GET', '/api/llm-usage', { token });
    const parsed = llmUsageListSchema.parse(usage.body);
    expect(parsed.logs.some((row) => row.capability === 'chat' && row.model === 'gpt-4o-mini' && row.promptTokens > 0)).toBe(true);
    expect(parsed.byCapability.map((row) => row.capability)).toEqual(['chat', 'embed', 'rerank']);
    const chat = parsed.byCapability.find((row) => row.capability === 'chat');
    expect(chat && chat.calls > 0 && chat.promptTokens > 0 && chat.totalTokens >= chat.promptTokens).toBe(true);

    const switched = await call(app, 'PUT', `/api/llm-configs/${(second.body?.config as { id: string }).id}/default`, { cookie });
    expect((switched.body?.config as { isDefault: boolean }).isDefault).toBe(true);
    await call(app, 'DELETE', `/api/llm-configs/${(second.body?.config as { id: string }).id}`, { cookie });
    await call(app, 'PUT', `/api/llm-configs/${config.id}/default`, { cookie });
  });

  it('rejects a private model URL in production', async () => {
    const dir = await makeDataDir();
    const prod = await openTestApp({ dataDir: dir, config: testConfig({ APP_ENV: 'production' }) });
    try {
      const registered = await call(prod, 'POST', '/api/auth/register', {
        payload: { email: 'llm-prod@example.com', password: 'password-llm' },
      });
      const prodCookie = sessionCookie(registered.headers);
      const denied = await call(prod, 'POST', '/api/llm-configs', {
        cookie: prodCookie,
        payload: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          apiKey: 'sk-test-secret-value-123456',
          baseUrl: 'http://127.0.0.1:9/v1',
        },
      });
      expect(denied.status).toBe(400);
      expect(JSON.stringify(denied.body)).toContain('模型地址必须是公网 HTTPS');
      expect(JSON.stringify(denied.body)).not.toContain('127.0.0.1');
    } finally {
      await prod.close();
      await removeDataDir(dir);
    }
  });

  it('records embedding and rerank cost against the calling user', async () => {
    const saved = await call(app, 'POST', '/api/memories', {
      token,
      payload: { content: '成本记录-向量这条要入账', type: 'fact' },
    });
    expect(saved.status).toBe(201);
    const other = await call(app, 'POST', '/api/memories', {
      token,
      payload: { content: '成本记录-另一条候选，用来触发精排', type: 'fact' },
    });
    expect(other.status).toBe(201);
    const settings = await call(app, 'PUT', '/api/settings', {
      token,
      payload: {
        rerankEnabled: true,
        rerankBaseUrl: standin.url,
        rerankModel: 'gte-rerank-v2',
        rerankApiKey: 'rerank-secret',
      },
    });
    expect(settings.status).toBe(200);
    const recalled = await call(app, 'POST', '/api/memories/recall', {
      token,
      payload: { query: '成本记录', limit: 5 },
    });
    expect(recalled.status).toBe(200);
    const rows = await app.ctx.db.select().from(llmUsageLogs).where(eq(llmUsageLogs.userId, (await userId()) ));
    expect(rows.some((row) => row.capability === 'embed' && row.model === 'qwen3-vl-embedding' && row.promptTokens > 0)).toBe(true);
    expect(rows.some((row) => row.capability === 'rerank' && row.model === 'gte-rerank-v2')).toBe(true);
    expect(rows.every((row) => !JSON.stringify(row).includes('rerank-secret'))).toBe(true);
    const usage = llmUsageListSchema.parse((await call(app, 'GET', '/api/llm-usage', { token })).body);
    const embed = usage.byCapability.find((row) => row.capability === 'embed');
    const rerank = usage.byCapability.find((row) => row.capability === 'rerank');
    expect(embed && embed.calls > 0 && embed.promptTokens > 0 && embed.totalTokens >= embed.promptTokens).toBe(true);
    expect(rerank && rerank.calls > 0 && rerank.totalTokens > 0).toBe(true);
    expect(usage.totalTokens).toBeGreaterThanOrEqual(usage.byCapability.reduce((sum, row) => sum + row.totalTokens, 0));
  });

  it('skips semantic merge until a model exists, then evolves by title inside the project', async () => {
    const bareDir = await makeDataDir();
    const bare = await openTestApp({ dataDir: bareDir });
    try {
      const registered = await call(bare, 'POST', '/api/auth/register', {
        payload: { email: 'bare@example.com', password: 'password-llm' },
      });
      const bareCookie = sessionCookie(registered.headers);
      await call(bare, 'POST', '/api/memories', {
        cookie: bareCookie,
        payload: { content: '两条教训甲', type: 'lesson', project: 'sem' },
      });
      await call(bare, 'POST', '/api/memories', {
        cookie: bareCookie,
        payload: { content: '两条教训乙', type: 'lesson', project: 'sem' },
      });
      const dry = await call(bare, 'POST', '/api/memories/consolidate', { cookie: bareCookie, payload: {} });
      expect(dry.status).toBe(200);
      expect((dry.body?.semantic as { skipped: boolean; reason: string }).skipped).toBe(true);
      expect((dry.body?.semantic as { reason: string }).reason).toContain('尚未配置大模型');
    } finally {
      await bare.close();
      await removeDataDir(bareDir);
    }

    await call(app, 'POST', '/api/memories', {
      token,
      payload: { content: '重建索引前要先停写，否则会读到半截向量', type: 'lesson', project: 'sem' },
    });
    await call(app, 'POST', '/api/memories', {
      token,
      payload: { content: '索引重建时如果还在写入，向量会不完整', type: 'lesson', project: 'sem' },
    });
    await call(app, 'POST', '/api/memories', {
      token,
      payload: { content: '列表默认按更新时间排', type: 'preference', project: 'sem' },
    });

    llmTransport.fetch = async (_url, init) => {
      const payload = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
      const ids = [...payload.messages.at(-1)!.content.matchAll(/id=([0-9a-f-]{36})/g)].map((match) => match[1]);
      const content = JSON.stringify({
        merges: [
          {
            title: '索引要先排空',
            type: 'lesson',
            content: '重建索引前先停写，避免读到半截向量。',
            sourceIds: ids.slice(0, 2),
          },
        ],
      });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content } }],
          usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    const merged = await call(app, 'POST', '/api/memories/consolidate', { token, payload: {} });
    expect(merged.status).toBe(200);
    const semantic = merged.body?.semantic as { skipped: boolean; created: number; absorbed: number; executionId?: string };
    expect(semantic.skipped).toBe(false);
    expect(semantic.created).toBe(1);
    expect(semantic.absorbed).toBe(2);

    const lessons = await call(app, 'GET', '/api/memories?type=lesson&project=sem', { token });
    const lessonRows = (lessons.body?.memories as Array<{ content: string; tags: string[] }>) ?? [];
    expect(lessonRows).toHaveLength(1);
    expect(lessonRows[0]?.content.startsWith('# 索引要先排空')).toBe(true);
    expect(lessonRows[0]?.tags).toContain('semantic');
    const prefs = await call(app, 'GET', '/api/memories?type=preference&project=sem', { token });
    expect((prefs.body?.memories as unknown[]).length).toBe(1);

    const executions = semantic.executionId
      ? await app.ctx.db.select().from(agentExecutions).where(eq(agentExecutions.id, semantic.executionId))
      : [];
    expect(executions[0]?.status).toBe('done');
    expect(JSON.stringify(executions[0]?.turns)).not.toContain('半截向量');

    await call(app, 'POST', '/api/memories', {
      token,
      payload: { content: '停写之后再重建索引，向量才完整', type: 'lesson', project: 'sem' },
    });
    const again = await call(app, 'POST', '/api/memories/consolidate', { token, payload: {} });
    const second = again.body?.semantic as { evolved: number; created: number; absorbed: number };
    expect(second.evolved).toBe(1);
    expect(second.created).toBe(0);
    expect(second.absorbed).toBe(1);
    const after = await call(app, 'GET', '/api/memories?type=lesson&project=sem', { token });
    expect((after.body?.memories as unknown[]).length).toBe(1);
  });

  async function userId(): Promise<string> {
    const me = await call(app, 'GET', '/api/auth/me', { token });
    return (me.body?.user as { id: string }).id;
  }
});
