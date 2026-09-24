import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppError } from '../errors.js';
import { createRetrieval } from './ports.js';
import { startProtocolStandin, type ProtocolStandIn } from './protocol-standin.js';
import { publicRerankFailure } from './rerank.js';
import { RetrievalError } from './http.js';
import { call, makeDataDir, openTestApp, removeDataDir, sessionCookie, testConfig } from '../test/app-harness.js';
import { assertRerankBaseUrl, RERANK_URL_REJECTED_MESSAGE, type DnsResolver, type RerankUrlGuardOptions } from './url-guard.js';

const PUBLIC_V4 = '93.184.216.34';

function resolver(answers: Record<string, readonly string[]>): DnsResolver & { calls: string[] } {
  const calls: string[] = [];
  const resolve: DnsResolver & { calls: string[] } = async (hostname: string) => {
    calls.push(hostname);
    const found = answers[hostname];
    if (!found) throw new Error(`unexpected lookup for ${hostname}`);
    return found;
  };
  resolve.calls = calls;
  return resolve;
}

async function expectRejected(rawUrl: string, options: RerankUrlGuardOptions): Promise<void> {
  try {
    await assertRerankBaseUrl(rawUrl, options);
    throw new Error(`expected reject for ${rawUrl}`);
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    const rejected = err as AppError;
    expect(rejected.status).toBe(400);
    expect(rejected.code).toBe('VALIDATION');
    expect(rejected.message).toBe(RERANK_URL_REJECTED_MESSAGE);
  }
}

describe('rerank url guard', () => {
  const blockedDns = [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.5.5',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '255.255.255.255',
    '224.0.0.1',
    '240.0.0.1',
    '192.0.2.1',
    '198.51.100.1',
    '203.0.113.1',
    '::1',
    '::',
    'fc00::1',
    'fd00::1',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
    '::ffff:127.0.0.1',
    '::ffff:169.254.169.254',
    '2002:a9fe:a9fe::',
  ];

  it('rejects non-public targets in production without calling live DNS', async () => {
    const deny = resolver({});
    const literals = [
      'http://example.com/v1',
      'https://169.254.169.254/',
      'https://10.1.2.3/',
      'https://192.168.1.20/rerank',
      'https://127.0.0.1/',
      'https://[::1]/',
      'https://100.64.1.1/',
      'https://user:pass@example.com/',
      'https://localhost/v1',
      'https://foo.localhost/v1',
      'https://foo.local/v1',
      'https://foo.internal/v1',
      'https://2130706433/',
      'https://0x7f000001/',
      'https://0177.0.0.1/',
      'https://8.8.8.8/',
      'https://[::ffff:127.0.0.1]/',
    ];
    for (const rawUrl of literals) {
      await expectRejected(rawUrl, { appEnv: 'production', resolve: deny });
    }
    expect(deny.calls).toEqual([]);

    await expectRejected('https://loop.example/v1', {
      appEnv: 'production',
      resolve: async () => ['127.0.0.1'],
    });
    await expectRejected('https://metadata.example/v1', {
      appEnv: 'production',
      resolve: async () => ['169.254.169.254'],
    });
    for (const address of blockedDns) {
      await expectRejected('https://blocked.example/v1', {
        appEnv: 'production',
        resolve: async () => [address],
      });
    }
    await expectRejected('https://split.example/v1', {
      appEnv: 'production',
      resolve: async () => [PUBLIC_V4, '10.0.0.1'],
    });

    try {
      await assertRerankBaseUrl('https://secret.example/v1', {
        appEnv: 'production',
        resolve: async () => {
          throw new Error('getaddrinfo ENOTFOUND secret.example');
        },
      });
      throw new Error('expected dns failure to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).message).toBe(RERANK_URL_REJECTED_MESSAGE);
      expect((err as AppError).message).not.toContain('secret.example');
    }
  });

  it('accepts https whose injected addresses are all public', async () => {
    const resolve = resolver({
      'public.example': [PUBLIC_V4],
      'v6.example': ['2606:4700:4700::1111'],
      'dual.example': [PUBLIC_V4, '2606:4700:4700::1111'],
      'edge.example': ['100.128.0.1', '172.32.0.1', '11.0.0.1'],
    });
    await expect(
      assertRerankBaseUrl('https://public.example/api/v1', { appEnv: 'production', resolve }),
    ).resolves.toBeUndefined();
    await expect(
      assertRerankBaseUrl('https://v6.example/api/v1', { appEnv: 'production', resolve }),
    ).resolves.toBeUndefined();
    await expect(
      assertRerankBaseUrl('https://dual.example/api/v1', { appEnv: 'production', resolve }),
    ).resolves.toBeUndefined();
    await expect(
      assertRerankBaseUrl('https://edge.example/api/v1', { appEnv: 'production', resolve }),
    ).resolves.toBeUndefined();
    expect(resolve.calls).toEqual(['public.example', 'v6.example', 'dual.example', 'edge.example']);
  });

  it('keeps the loopback stand-in outside production and still rejects other schemes', async () => {
    let called = false;
    const resolve: DnsResolver = async () => {
      called = true;
      return ['127.0.0.1'];
    };
    await expect(
      assertRerankBaseUrl('http://127.0.0.1:9/v1', { appEnv: 'test', resolve }),
    ).resolves.toBeUndefined();
    await expect(
      assertRerankBaseUrl('http://127.0.0.1:9/v1', { appEnv: 'development', resolve }),
    ).resolves.toBeUndefined();
    expect(called).toBe(false);
    await expectRejected('file:///etc/passwd', { appEnv: 'test', resolve });
    await expectRejected('javascript:alert(1)', { appEnv: 'development', resolve });
  });

  it('reads APP_ENV when the caller does not pass one', async () => {
    const previous = process.env.APP_ENV;
    process.env.APP_ENV = 'production';
    try {
      await expectRejected('http://127.0.0.1:9/', { resolve: async () => [PUBLIC_V4] });
    } finally {
      if (previous === undefined) delete process.env.APP_ENV;
      else process.env.APP_ENV = previous;
    }
  });

  it('strips upstream URL and body from rerank failures', () => {
    const upstream = new RetrievalError(
      'HTTP_5XX',
      'request POST http://127.0.0.1:9/services/rerank failed: {"message":"rerank failed"}',
      500,
    );
    expect(publicRerankFailure(upstream)).toBe('rerank failed with status 500');
    expect(publicRerankFailure(new Error('connect ECONNREFUSED http://169.254.169.254/'))).toBe(
      'rerank failed (network)',
    );
    expect(publicRerankFailure(new RetrievalError('BAD_RESPONSE', 'rerank response missing output.results'))).toBe(
      'rerank failed (network)',
    );
  });
});

describe('production settings reject private rerank URLs', () => {
  let dataDir = '';
  let app: FastifyInstance | undefined;
  let cookie = '';
  const previous = process.env.APP_ENV;

  beforeAll(async () => {
    process.env.APP_ENV = 'production';
    dataDir = await makeDataDir();
    app = await openTestApp({ dataDir, config: testConfig({ APP_ENV: 'production' }) });
    const registered = await call(app, 'POST', '/api/auth/register', {
      payload: { email: 'rerank-ssrf@example.com', password: 'password-ssrf' },
    });
    expect(registered.status).toBe(201);
    cookie = sessionCookie(registered.headers);
  });

  afterAll(async () => {
    if (previous === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = previous;
    if (app) await app.close();
    if (dataDir) await removeDataDir(dataDir);
  });

  it.each(['http://127.0.0.1:9', 'https://169.254.169.254/', 'https://user:pass@example.com/'])(
    'rejects %s without echoing the host',
    async (rerankBaseUrl) => {
      const saved = await call(app as FastifyInstance, 'PUT', '/api/settings', {
        cookie,
        payload: { rerankEnabled: true, rerankBaseUrl },
      });
      expect(saved.status).toBe(400);
      expect(saved.body).toEqual({ error: { code: 'VALIDATION', message: RERANK_URL_REJECTED_MESSAGE } });
      const encoded = JSON.stringify(saved.body);
      expect(encoded).not.toContain('127.0.0.1');
      expect(encoded).not.toContain('169.254.169.254');
      expect(encoded).not.toContain('example.com');
      expect(encoded).not.toContain('user:pass');
    },
  );
});

interface LocalServer {
  url: string;
  hits: () => number;
  close: () => Promise<void>;
}

function startLocalServer(onRequest: (req: IncomingMessage, res: ServerResponse) => void): Promise<LocalServer> {
  let hits = 0;
  const server = createServer((req, res) => {
    hits += 1;
    onRequest(req, res);
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('local server failed to bind'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${String(address.port)}`,
        hits: () => hits,
        close: () =>
          new Promise((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
          }),
      });
    });
  });
}

describe('rerank redirects and stored private URLs', () => {
  const bodyMarker = 'upstream-redirect-body-7f3c1a9e';
  const targetMarker = 'upstream-redirect-target-b91e04c2';
  let dataDir = '';
  let app: FastifyInstance;
  let standin: ProtocolStandIn;
  let source: LocalServer;
  let target: LocalServer;
  let location = '';
  let cookie = '';
  let firstId = '';
  let secondId = '';

  beforeAll(async () => {
    expect(process.env.APP_ENV).not.toBe('production');
    standin = await startProtocolStandin();
    target = await startLocalServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(targetMarker);
    });
    location = `${target.url}/rerank-location-secret`;
    source = await startLocalServer((_req, res) => {
      res.writeHead(302, { location, 'content-type': 'text/plain' });
      res.end(bodyMarker);
    });
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
      payload: { email: 'rerank-redirect@example.com', password: 'password-redirect' },
    });
    cookie = sessionCookie(registered.headers);
    const created = async (content: string) => {
      const res = await call(app, 'POST', '/api/memories', { cookie, payload: { content } });
      expect(res.status).toBe(201);
      return (res.body?.memory as { id: string }).id;
    };
    firstId = await created('重定向回退的松');
    secondId = await created('重定向回退的梅');
  });

  afterAll(async () => {
    await app.close();
    await standin.close();
    await source.close();
    await target.close();
    await removeDataDir(dataDir);
  });

  it('does not follow a rerank redirect or keep either marker', async () => {
    standin.control.script = { meiliIds: [firstId, secondId], qdrantIds: [] };
    const saved = await call(app, 'PUT', '/api/settings', {
      cookie,
      payload: {
        rerankEnabled: true,
        rerankBaseUrl: source.url,
        rerankModel: 'gte-rerank-v2',
        rerankApiKey: 'rk-redirect',
      },
    });
    expect(saved.status).toBe(200);
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map((arg) => String(arg)).join(' '));
    });
    try {
      const recalled = await call(app, 'POST', '/api/memories/recall', { cookie, payload: { query: '重定向' } });
      expect(recalled.status).toBe(200);
      expect((recalled.body?.memories as { id: string }[]).map((item) => item.id)).toEqual([firstId, secondId]);
      expect(JSON.stringify(recalled.body)).not.toContain(bodyMarker);
      expect(JSON.stringify(recalled.body)).not.toContain(targetMarker);
      expect(JSON.stringify(recalled.body)).not.toContain(location);

      const listed = await call(app, 'GET', '/api/memories/recall-logs', { cookie });
      const log = (listed.body?.logs as { query: string; rerankError: string | null }[])[0];
      expect(log?.query).toBe('重定向');
      expect(log?.rerankError).toBe('rerank failed with status 302');
      expect(log?.rerankError).not.toContain(bodyMarker);
      expect(log?.rerankError).not.toContain(targetMarker);
      expect(log?.rerankError).not.toContain(location);
      expect(errors.join('\n')).not.toContain(bodyMarker);
      expect(errors.join('\n')).not.toContain(targetMarker);
      expect(errors.join('\n')).not.toContain(location);
      expect(source.hits()).toBeGreaterThan(0);
      expect(target.hits()).toBe(0);
    } finally {
      spy.mockRestore();
      standin.control.script = null;
    }
  });

  it('fails closed at request time when a stored loopback URL meets production', async () => {
    standin.control.script = { meiliIds: [firstId, secondId], qdrantIds: [] };
    const saved = await call(app, 'PUT', '/api/settings', {
      cookie,
      payload: { rerankEnabled: true, rerankBaseUrl: standin.url, rerankApiKey: 'rk-stored' },
    });
    expect(saved.status).toBe(200);
    const before = standin.control.rerankRequests.length;
    const warmed = await call(app, 'POST', '/api/memories/recall', { cookie, payload: { query: '已存地址' } });
    expect(warmed.status).toBe(200);
    expect(standin.control.rerankRequests.length).toBe(before + 1);

    const previous = process.env.APP_ENV;
    process.env.APP_ENV = 'production';
    try {
      const recalled = await call(app, 'POST', '/api/memories/recall', { cookie, payload: { query: '生产关闭' } });
      expect(recalled.status).toBe(200);
      expect((recalled.body?.memories as { id: string }[]).map((item) => item.id)).toEqual([firstId, secondId]);
      expect(standin.control.rerankRequests.length).toBe(before + 1);
      const listed = await call(app, 'GET', '/api/memories/recall-logs', { cookie });
      const log = (listed.body?.logs as { query: string; rerankError: string | null }[])[0];
      expect(log?.query).toBe('生产关闭');
      expect(log?.rerankError).toBe('rerank failed (network)');
      expect(log?.rerankError).not.toContain('127.0.0.1');
    } finally {
      if (previous === undefined) delete process.env.APP_ENV;
      else process.env.APP_ENV = previous;
      standin.control.script = null;
    }
  });
});
