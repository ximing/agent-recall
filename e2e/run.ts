/**
 * 服务与 MCP 端到端。
 *
 * 远端 Postgres 的隔离 schema + protocol-standin，注册固定测试账号，灌入 e2e/corpus.ts，
 * 再拉起真正的 stdio MCP，把 66 个工具和账号/钩子/隔离走一遍。
 * 不碰 ~/.agent-recall，不写 public，也不打开网页。
 *
 * 运行：仓库根目录 `pnpm e2e`。失败时进程退出码为 1。
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type { FastifyInstance } from 'fastify';
import { CRYSTAL_SESSION, E2E_ACCOUNT, E2E_MESH, E2E_PEER, PROJECT, SESSION } from './account.js';
import { CORPUS, MARK } from './corpus.js';
import { McpClient, type ToolResult } from './mcp-client.js';
import { CORE_TOOLS, FULL_TOOLS, diffToolNames, standardTools } from './tools.js';
import type { AppConfig } from '../apps/server/src/config.js';
import { createRetrieval } from '../apps/server/src/retrieval/ports.js';
import { startProtocolStandin, type ProtocolStandIn } from '../apps/server/src/retrieval/protocol-standin.js';
import {
  call,
  makeDataDir,
  openTestApp,
  removeDataDir,
  sessionCookie,
  testConfig,
  type CallResult,
} from '../apps/server/src/test/app-harness.js';

class Stop extends Error {}

class Report {
  passed = 0;
  failed = 0;
  private readonly started = performance.now();

  async step(name: string, fn: () => Promise<void>): Promise<boolean> {
    const start = performance.now();
    try {
      await fn();
      this.passed += 1;
      console.log(`  ok   ${name}  ${String(Math.round(performance.now() - start))}ms`);
      return true;
    } catch (error) {
      this.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.log(`  FAIL ${name}  ${String(Math.round(performance.now() - start))}ms`);
      for (const line of message.split('\n')) console.log(`       ${line}`);
      return false;
    }
  }

  summary(): void {
    const seconds = ((performance.now() - this.started) / 1000).toFixed(1);
    console.log(`\n${this.failed === 0 ? 'PASS' : 'FAIL'}  ${String(this.passed)} passed, ${String(this.failed)} failed  ${seconds}s`);
  }
}

class Resources {
  dataDir = '';
  meshDir = '';
  workDir = '';
  standin: ProtocolStandIn | null = null;
  app: FastifyInstance | null = null;
  meshApp: FastifyInstance | null = null;
  config: AppConfig | null = null;
  base = '';
  meshBase = '';
  cookie = '';
  token = '';
  tokenId = '';
  profileToken = '';
  peerToken = '';
  meshToken = '';
  ids = new Map<string, string>();
  mcp: McpClient | null = null;
  peerMcp: McpClient | null = null;

  async close(): Promise<void> {
    this.mcp?.close();
    this.peerMcp?.close();
    this.mcp = null;
    this.peerMcp = null;
    await this.app?.close().catch(() => undefined);
    await this.meshApp?.close().catch(() => undefined);
    this.app = null;
    this.meshApp = null;
    await this.standin?.close().catch(() => undefined);
    this.standin = null;
    if (this.dataDir) await removeDataDir(this.dataDir);
    if (this.meshDir) await removeDataDir(this.meshDir);
    if (this.workDir) await rm(this.workDir, { recursive: true, force: true });
    this.dataDir = '';
    this.meshDir = '';
    this.workDir = '';
  }
}

function primary(resources: Resources): FastifyInstance {
  if (!resources.app) throw new Error('server is not running');
  return resources.app;
}

function agent(resources: Resources): McpClient {
  if (!resources.mcp) throw new Error('mcp is not running');
  return resources.mcp;
}

async function gate(report: Report, name: string, fn: () => Promise<void>): Promise<void> {
  const ok = await report.step(name, fn);
  if (!ok) throw new Stop();
}

function http(status: number, result: CallResult, label: string): Record<string, unknown> {
  if (result.status !== status) {
    throw new Error(`${label}: HTTP ${String(result.status)} ${JSON.stringify(result.body).slice(0, 500)}`);
  }
  return (result.body ?? {}) as Record<string, unknown>;
}

function obj(result: ToolResult, label: string): Record<string, unknown> {
  if (typeof result.json !== 'object' || result.json === null || Array.isArray(result.json)) {
    throw new Error(`${label}: expected JSON object\n${result.text.slice(0, 700)}`);
  }
  return result.json;
}

function has(result: ToolResult, needle: string): void {
  if (!result.text.includes(needle)) {
    throw new Error(`missing ${JSON.stringify(needle)}\n${result.text.slice(0, 800)}`);
  }
}

function lacks(text: string, needle: string): void {
  if (text.includes(needle)) throw new Error(`should not contain ${JSON.stringify(needle)}\n${text.slice(0, 800)}`);
}

function memId(record: Record<string, unknown>, label: string): string {
  const memory = record.memory;
  if (typeof memory !== 'object' || memory === null) throw new Error(`${label}: missing memory\n${JSON.stringify(record).slice(0, 400)}`);
  const id = (memory as { id?: unknown }).id;
  if (typeof id !== 'string') throw new Error(`${label}: missing memory id`);
  return id;
}

function asMemories(record: Record<string, unknown>, label: string): Array<Record<string, unknown>> {
  const memories = record.memories;
  if (!Array.isArray(memories)) throw new Error(`${label}: missing memories\n${JSON.stringify(record).slice(0, 400)}`);
  return memories.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
}

function retrievalConfig(standinUrl: string): AppConfig {
  return testConfig({
    MEILI_URL: standinUrl,
    MEILI_API_KEY: 'meili-e2e',
    QDRANT_URL: standinUrl,
    QDRANT_API_KEY: 'qdrant-e2e',
    EMBEDDING_API_KEY: 'dash-e2e',
    EMBEDDING_BASE_URL: standinUrl,
    EMBEDDING_DIMENSIONS: 8,
  });
}

async function bind(app: FastifyInstance): Promise<string> {
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  return `http://127.0.0.1:${String(address.port)}`;
}

async function registerToken(
  app: FastifyInstance,
  email: string,
  password: string,
  tokenName: string,
): Promise<{ cookie: string; token: string; tokenId: string }> {
  const registered = await call(app, 'POST', '/api/auth/register', { payload: { email, password } });
  const body = http(201, registered, `register ${email}`);
  const user = body.user as { email?: string };
  if (user.email !== email) throw new Error(`register returned ${String(user.email)}`);
  const cookie = sessionCookie(registered.headers);
  const created = await call(app, 'POST', '/api/tokens', { cookie, payload: { name: tokenName } });
  const tokenBody = http(201, created, `token ${tokenName}`);
  const secret = String(tokenBody.secret);
  if (!secret.startsWith('arm_')) throw new Error(`token secret does not start with arm_`);
  const tokenId = (tokenBody.token as { id?: string }).id;
  if (!tokenId) throw new Error('token id missing');
  return { cookie, token: secret, tokenId };
}

function clearProxy(): void {
  for (const key of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'all_proxy']) {
    delete process.env[key];
  }
}

async function scenario(report: Report, resources: Resources): Promise<void> {
  await gate(report, 'catalog matches itself', async () => {
    if (new Set(FULL_TOOLS).size !== FULL_TOOLS.length) throw new Error('FULL_TOOLS has duplicates');
    if (FULL_TOOLS.length !== 66) throw new Error(`expected 66 tools, listed ${String(FULL_TOOLS.length)}`);
    if (CORE_TOOLS.length !== 12) throw new Error(`core ${String(CORE_TOOLS.length)}`);
    if (standardTools().length !== 25) throw new Error(`standard ${String(standardTools().length)}`);
    for (const name of standardTools()) {
      if (!FULL_TOOLS.includes(name as (typeof FULL_TOOLS)[number])) throw new Error(`${name} missing from FULL_TOOLS`);
    }
  });

  await gate(report, 'boot isolated server', async () => {
    resources.standin = await startProtocolStandin();
    resources.dataDir = await makeDataDir();
    resources.meshDir = await makeDataDir();
    resources.workDir = await mkdtemp(path.join(tmpdir(), 'agent-recall-e2e-files-'));
    resources.config = retrievalConfig(resources.standin.url);
    resources.app = await openTestApp({
      dataDir: resources.dataDir,
      config: resources.config,
      retrieval: createRetrieval(resources.config),
    });
    resources.base = await bind(resources.app);
    const meshConfig = retrievalConfig(resources.standin.url);
    resources.meshApp = await openTestApp({
      dataDir: resources.meshDir,
      config: meshConfig,
      retrieval: createRetrieval(meshConfig),
    });
    resources.meshBase = await bind(resources.meshApp);
    const health = http(200, await call(resources.app, 'GET', '/health'), 'health');
    if (health.ok !== true) throw new Error(JSON.stringify(health));
  });

  await gate(report, 'http accounts, tokens, settings', async () => {
    const app = primary(resources);
    const owner = await registerToken(app, E2E_ACCOUNT.email, E2E_ACCOUNT.password, E2E_ACCOUNT.tokenName);
    resources.cookie = owner.cookie;
    resources.token = owner.token;
    resources.tokenId = owner.tokenId;
    const duplicate = await call(app, 'POST', '/api/auth/register', {
      payload: { email: E2E_ACCOUNT.email, password: E2E_ACCOUNT.password },
    });
    if (duplicate.status !== 409) throw new Error(`duplicate register HTTP ${String(duplicate.status)}`);
    const bad = await call(app, 'POST', '/api/auth/login', {
      payload: { email: E2E_ACCOUNT.email, password: 'wrong-password' },
    });
    if (bad.status !== 401) throw new Error(`bad login HTTP ${String(bad.status)}`);
    const login = await call(app, 'POST', '/api/auth/login', {
      payload: { email: E2E_ACCOUNT.email, password: E2E_ACCOUNT.password },
    });
    http(200, login, 'login');
    const anon = await call(app, 'GET', '/api/memories');
    if (anon.status !== 401) throw new Error(`anon HTTP ${String(anon.status)}`);
    const me = http(200, await call(app, 'GET', '/api/auth/me', { cookie: resources.cookie }), 'me');
    if ((me.user as { email?: string }).email !== E2E_ACCOUNT.email) throw new Error('me email mismatch');

    const listed = await call(app, 'GET', '/api/tokens', { cookie: resources.cookie });
    const listedText = JSON.stringify(listed.body);
    if (listedText.includes(resources.token)) throw new Error('token list leaked the secret');

    const profile = await call(app, 'POST', '/api/tokens', {
      cookie: resources.cookie,
      payload: { name: 'e2e-profile' },
    });
    resources.profileToken = String(http(201, profile, 'profile token').secret);

    const peer = await registerToken(app, E2E_PEER.email, E2E_PEER.password, E2E_PEER.tokenName);
    resources.peerToken = peer.token;
    const mesh = await registerToken(resources.meshApp!, E2E_MESH.email, E2E_MESH.password, E2E_MESH.tokenName);
    resources.meshToken = mesh.token;

    const mcpClient = http(
      201,
      await call(app, 'POST', '/api/mcp/clients', { cookie: resources.cookie, payload: { name: 'e2e-client' } }),
      'mcp client',
    );
    const mcpSecret = String(mcpClient.secret);
    if (!String(mcpClient.config).includes(mcpSecret)) throw new Error('mcp config omitted the secret');
    const clients = JSON.stringify((await call(app, 'GET', '/api/mcp/clients', { cookie: resources.cookie })).body);
    if (clients.includes(mcpSecret)) throw new Error('mcp client list leaked the secret');
    const clientId = (mcpClient.client as { id?: string }).id;
    http(200, await call(app, 'POST', `/api/mcp/clients/${String(clientId)}/revoke`, { cookie: resources.cookie }), 'revoke client');
    const denied = await call(app, 'POST', '/api/memories', { token: mcpSecret, payload: { content: '吊销后不该写入' } });
    if (denied.status !== 401) throw new Error(`revoked client HTTP ${String(denied.status)}`);

    http(200, await call(app, 'GET', '/api/settings', { cookie: resources.cookie }), 'settings');
    const tuned = http(
      200,
      await call(app, 'PUT', '/api/settings', {
        cookie: resources.cookie,
        payload: { rerankEnabled: false, autoForgetDays: 7 },
      }),
      'settings put',
    );
    if ((tuned.settings as { autoForgetDays?: number }).autoForgetDays !== 7) throw new Error(JSON.stringify(tuned));
    const reset = http(
      200,
      await call(app, 'PUT', '/api/settings', {
        cookie: resources.cookie,
        payload: { rerankEnabled: false, autoForgetDays: 0 },
      }),
      'settings reset',
    );
    if ((reset.settings as { rerankEnabled?: boolean; autoForgetDays?: number }).autoForgetDays !== 0) {
      throw new Error(JSON.stringify(reset));
    }
  });

  await gate(report, 'seed corpus', async () => {
    const app = primary(resources);
    for (const item of CORPUS) {
      const created = await call(app, 'POST', '/api/memories', {
        token: resources.token,
        payload: {
          content: item.content,
          type: item.type,
          tags: item.tags,
          project: item.project,
          ...(item.sessionId ? { sessionId: item.sessionId } : {}),
        },
      });
      const body = http(201, created, `seed ${item.key}`);
      resources.ids.set(item.key, memId(body, item.key));
    }
    const stats = http(200, await call(app, 'GET', '/api/memories/stats', { token: resources.token }), 'stats');
    const total = (stats.stats as { total?: number }).total;
    if (total !== CORPUS.length) throw new Error(`seeded total ${String(total)}`);
  });

  await gate(report, 'connect mcp', async () => {
    resources.mcp = McpClient.start(resources.base, resources.token);
    resources.peerMcp = McpClient.start(resources.base, resources.peerToken);
    const initialized = await resources.mcp.initialize();
    if (initialized.result?.protocolVersion !== '2024-11-05') {
      throw new Error(`protocol ${String(initialized.result?.protocolVersion)}`);
    }
    if (initialized.result?.serverInfo?.name !== 'agent-recall') {
      throw new Error(`server ${String(initialized.result?.serverInfo?.name)}`);
    }
    await resources.peerMcp.initialize();
    const names = await resources.mcp.toolNames();
    const diff = diffToolNames(names, FULL_TOOLS);
    if (diff) throw new Error(diff);
    const saveRequired = await resources.mcp.toolRequired('memory_save');
    const recallRequired = await resources.mcp.toolRequired('memory_recall');
    if (!saveRequired.includes('content') || !recallRequired.includes('query')) {
      throw new Error(`schema content=${saveRequired.join(',')} query=${recallRequired.join(',')}`);
    }
  });

  const mcp = () => agent(resources);
  const id = (key: string) => {
    const value = resources.ids.get(key);
    if (!value) throw new Error(`missing seeded id ${key}`);
    return value;
  };

  await report.step('mcp memory_stats and memory_list', async () => {
    const stats = obj(await mcp().call('memory_stats'), 'stats');
    if ((stats.stats as { total?: number }).total !== CORPUS.length) throw new Error(JSON.stringify(stats.stats));
    const listed = obj(await mcp().call('memory_list', { project: PROJECT, limit: 50 }), 'list');
    const memories = asMemories(listed, 'list');
    if (memories.length !== CORPUS.length) throw new Error(`listed ${String(memories.length)}`);
    if (!JSON.stringify(memories).includes(MARK.bug)) throw new Error('list missed the bug marker');
  });

  await report.step('mcp recall, smart_search, context, get', async () => {
    const recalled = await mcp().call('memory_recall', { query: MARK.arch });
    has(recalled, MARK.arch);
    const searched = await mcp().call('memory_smart_search', { query: MARK.pref });
    has(searched, MARK.pref);
    const context = await mcp().call('memory_context', { query: MARK.arch, tokenBudget: 800 });
    has(context, MARK.arch);
    const got = obj(await mcp().call('memory_get', { id: id('arch') }), 'get');
    const memory = got.memory as { origin?: string; type?: string; content?: string };
    if (memory.origin !== 'agent' || memory.type !== 'architecture' || !memory.content?.includes(MARK.arch)) {
      throw new Error(JSON.stringify(memory));
    }
    const empty = await mcp().fail('memory_recall', {});
    if (!empty.includes('query is required')) throw new Error(empty);
  });

  await report.step('mcp sessions, export, lessons, patterns, frontier', async () => {
    const sessions = obj(await mcp().call('memory_sessions'), 'sessions');
    const rows = sessions.sessions as Array<{ sessionId?: string; memoryCount?: number }>;
    const alpha = rows.find((row) => row.sessionId === SESSION);
    if (!alpha || (alpha.memoryCount ?? 0) < 2) throw new Error(JSON.stringify(rows));
    const timeline = await mcp().call('memory_session_timeline', { sessionId: SESSION });
    has(timeline, MARK.arch);
    has(timeline, MARK.flow);
    const exported = obj(await mcp().call('memory_export'), 'export');
    if (exported.format !== 'agent-recall/v1') throw new Error(String(exported.format));
    has({ text: JSON.stringify(exported), json: exported }, MARK.arch);
    const lessons = await mcp().call('memory_lesson_recall', { query: MARK.lesson });
    has(lessons, MARK.lesson);
    lacks(lessons.text, MARK.pattern);
    const patterns = await mcp().call('memory_patterns', {});
    has(patterns, MARK.pattern);
    const found = await mcp().call('memory_patterns', { query: MARK.pattern });
    has(found, MARK.pattern);
    const insights = await mcp().call('memory_insight_list', { limit: 20 });
    has(insights, MARK.lesson);
    has(insights, MARK.pattern);
    const cross = await mcp().call('memory_timeline', { sessionId: SESSION });
    has(cross, MARK.flow);
    const frontier = await mcp().call('memory_frontier', { limit: 10 });
    has(frontier, 'E2E');
  });

  await report.step('mcp graph, relations, commits, files, vision, verify', async () => {
    const graph = await mcp().call('memory_graph_query', { query: 'e2e' });
    has(graph, '"name":"e2e"');
    const related = await mcp().call('memory_relations', { id: id('arch') });
    has(related, MARK.pref);
    const sha = await mcp().call('memory_commit_lookup', { sha: MARK.commitSha });
    has(sha, MARK.commit);
    const commits = await mcp().call('memory_commits', { query: MARK.commit });
    has(commits, MARK.commit);
    const files = await mcp().call('memory_file_history', { path: MARK.file });
    has(files, 'e2eFixtureMarker');
    const vision = await mcp().call('memory_vision_search', { query: MARK.vision });
    has(vision, MARK.vision);
    const verified = await mcp().call('memory_verify', { id: id('arch') });
    has(verified, 'exists: true');
    has(verified, 'type: architecture');
    has(verified, '(latest)');
  });

  await report.step('isolation before share', async () => {
    const app = primary(resources);
    const recalled = await call(app, 'POST', '/api/memories/recall', {
      token: resources.peerToken,
      payload: { query: MARK.arch },
    });
    lacks(JSON.stringify(recalled.body), MARK.arch);
    const missing = await call(app, 'GET', `/api/memories/${id('arch')}`, { token: resources.peerToken });
    if (missing.status !== 404) throw new Error(`peer get HTTP ${String(missing.status)}`);
    const viaTool = await resources.peerMcp!.call('memory_recall', { query: MARK.arch });
    lacks(viaTool.text, MARK.arch);
    const denied = await resources.peerMcp!.fail('memory_get', { id: id('arch') });
    if (!denied.includes('API 404')) throw new Error(denied);
  });

  await report.step('http web origin and hooks', async () => {
    const app = primary(resources);
    const web = http(
      201,
      await call(app, 'POST', '/api/memories', {
        cookie: resources.cookie,
        payload: { content: `E2E网页标记-${MARK.web} 来自 cookie` },
      }),
      'web memory',
    );
    if ((web.memory as { origin?: string }).origin !== 'web') throw new Error(JSON.stringify(web.memory));
    const leaked = http(
      201,
      await call(app, 'POST', '/api/hooks/events', {
        token: resources.token,
        payload: {
          eventId: 'e2e-secret-evt-0001',
          hook: 'PostToolUse',
          toolName: 'Bash',
          sessionId: 'e2e-hooks',
          content: `配置更新：api_key = ${MARK.shareSecret} 已写入本地环境，数据库连接保持不变`,
        },
      }),
      'hook',
    );
    const stored = (leaked.memory as { content?: string; origin?: string }).content ?? '';
    if ((leaked.memory as { origin?: string }).origin !== 'hook') throw new Error('hook origin');
    lacks(stored, MARK.shareSecret);
    if (!stored.includes('REDACTED')) throw new Error(stored);
    const context = http(
      200,
      await call(app, 'POST', '/api/hooks/context', {
        token: resources.token,
        payload: { query: MARK.arch, tokenBudget: 800 },
      }),
      'hook context',
    );
    if (!String(context.context).includes(MARK.arch)) throw new Error(String(context.context).slice(0, 400));
  });

  await report.step('mcp remember, dedupe, update, versions', async () => {
    const remembered = obj(
      await mcp().call('memory_remember', {
        content: `E2E记住标记-${MARK.remember} 用户明确要求记住`,
        type: 'preference',
        tags: ['e2e'],
        project: PROJECT,
      }),
      'remember',
    );
    if (!JSON.stringify(remembered).includes(MARK.remember)) throw new Error('remember missed marker');
    const content = `E2E去重标记-${MARK.dedupe} 同一句只留一份`;
    const first = obj(await mcp().call('memory_save', { content, type: 'fact', tags: ['e2e'], project: PROJECT }), 'save');
    if (first.deduped !== false) throw new Error(JSON.stringify(first));
    const second = obj(await mcp().call('memory_save', { content }), 'dedupe');
    if (second.deduped !== true || memId(second, 'dedupe') !== memId(first, 'save')) throw new Error(JSON.stringify(second));
    const updated = obj(
      await mcp().call('memory_update', {
        id: id('pattern'),
        content: `E2E模式标记-${MARK.pattern} 第二版 编辑记忆会追加版本链`,
      }),
      'update',
    );
    const memory = updated.memory as { version?: number };
    if (memory.version !== 2) throw new Error(JSON.stringify(updated));
    const versions = obj(await mcp().call('memory_versions', { id: id('pattern') }), 'versions');
    const chain = versions.versions as Array<{ content?: string }>;
    if (chain.length !== 2) throw new Error(JSON.stringify(versions).slice(0, 400));
    const texts = chain.map((item) => item.content ?? '').join('\n');
    if (!texts.includes('第二版') || !texts.includes(MARK.pattern)) throw new Error(texts);
  });

  await report.step('mcp facet_tag, facet_query, verify chain', async () => {
    const tagged = obj(
      await mcp().call('memory_facet_tag', { id: id('bug'), dimension: 'topic', value: 'e2e-run' }),
      'facet_tag',
    );
    const memory = tagged.memory as { id?: string; version?: number; tags?: string[]; content?: string };
    if (memory.version !== 2 || !memory.tags?.includes('topic:e2e-run') || !memory.content?.includes(MARK.bug)) {
      throw new Error(JSON.stringify(memory));
    }
    const queried = await mcp().call('memory_facet_query', { dimension: 'topic', value: 'e2e-run' });
    has(queried, MARK.bug);
    const latest = await mcp().call('memory_verify', { id: String(memory.id) });
    has(latest, 'type: bug');
    has(latest, '(latest)');
    const superseded = await mcp().call('memory_verify', { id: id('bug') });
    has(superseded, '(superseded)');
  });

  await report.step('mcp sketch, compress, claude bridge', async () => {
    const created = obj(
      await mcp().call('memory_sketch_create', {
        content: `E2E速记标记-${MARK.sketch} 二十四小时草稿`,
        project: PROJECT,
      }),
      'sketch',
    );
    const sketch = created.memory as { id?: string; tags?: string[]; expiresAt?: string | null };
    if (!sketch.id || !sketch.tags?.includes('sketch') || !sketch.expiresAt) throw new Error(JSON.stringify(created));
    const promoted = obj(await mcp().call('memory_sketch_promote', { id: sketch.id }), 'promote');
    const next = promoted.memory as { content?: string; tags?: string[]; expiresAt?: unknown; version?: number };
    if (next.version !== 2 || next.expiresAt !== null || next.tags?.includes('sketch') || !next.content?.includes(MARK.sketch)) {
      throw new Error(JSON.stringify(promoted));
    }
    const fixturePath = path.join(resources.workDir, 'fixture.ts');
    await writeFile(fixturePath, 'export function e2eCompressMarker() {\n  return "e2e-compress";\n}\n');
    const compressed = await mcp().call('memory_compress_file', { path: fixturePath, project: PROJECT });
    has(compressed, '文件摘要');
    has(compressed, 'e2eCompressMarker');
    const bridgePath = path.join(resources.workDir, 'MEMORY.md');
    await writeFile(
      bridgePath,
      `# Memory\n\n- E2E桥接导入-${MARK.bridgeImport} 来自文件\n## E2E桥接标题-${MARK.bridgeHeading}\n`,
    );
    const imported = obj(await mcp().call('memory_claude_bridge_sync', { direction: 'from', path: bridgePath }), 'bridge from');
    if (Number(imported.entries) < 2) throw new Error(JSON.stringify(imported));
    const recalled = await mcp().call('memory_recall', { query: MARK.bridgeImport });
    has(recalled, MARK.bridgeImport);
    const exported = obj(await mcp().call('memory_claude_bridge_sync', { direction: 'to', path: bridgePath }), 'bridge to');
    if (Number(exported.written) < 1) throw new Error(JSON.stringify(exported));
    const markdown = await readFile(bridgePath, 'utf8');
    if (!markdown.includes(MARK.bridge) || !markdown.includes(MARK.bridgeImport)) throw new Error(markdown);
  });

  await report.step('mcp kv, profile, lease, routine, next', async () => {
    const app = primary(resources);
    http(
      200,
      await call(app, 'PUT', '/api/kv/routines/e2e-morning', {
        token: resources.token,
        payload: { value: { steps: ['recall', 'reflect'] } },
      }),
      'routine',
    );
    const checkpoint = await mcp().call('memory_checkpoint', { name: 'e2e-ckpt', state: { phase: 'seeded' } });
    has(checkpoint, 'e2e-ckpt');
    has(checkpoint, 'seeded');
    await mcp().call('memory_signal_send', { name: 'e2e-deploy', data: { build: 'e2e-signal' } });
    const signal = await mcp().call('memory_signal_read', { name: 'e2e-deploy' });
    has(signal, 'e2e-signal');
    const action = obj(await mcp().call('memory_action_create', { title: MARK.action, detail: '跑完断言' }), 'action');
    const actionId = String(action.id);
    const briefing = await mcp().call('memory_next');
    has(briefing, 'Open actions');
    has(briefing, MARK.action);
    has(briefing, 'Recent memories:');
    const done = obj(await mcp().call('memory_action_update', { id: actionId, status: 'done' }), 'action update');
    if (done.status !== 'done') throw new Error(JSON.stringify(done));
    const after = await mcp().call('memory_next');
    lacks(after.text, MARK.action);
    await mcp().call('memory_sentinel_create', { name: 'e2e-watch', condition: '索引延迟超过 1s' });
    const fired = await mcp().call('memory_sentinel_trigger', { name: 'e2e-watch', note: '演练触发' });
    has(fired, '演练触发');
    await mcp().call('memory_slot_create', { name: 'e2e-task', value: { step: 1 } });
    const replaced = await mcp().call('memory_slot_replace', { name: 'e2e-task', value: { step: 2 } });
    has(replaced, '"step":2');
    const got = await mcp().call('memory_slot_get', { name: 'e2e-task' });
    has(got, '"step":2');
    await mcp().call('memory_slot_append', { name: 'e2e-log', value: 'line-1' });
    const appended = await mcp().call('memory_slot_append', { name: 'e2e-log', value: 'line-2' });
    has(appended, 'line-1');
    has(appended, 'line-2');
    const slots = await mcp().call('memory_slot_list');
    has(slots, 'e2e-task');
    has(slots, 'e2e-log');
    const removed = obj(await mcp().call('memory_slot_delete', { name: 'e2e-task' }), 'slot delete');
    if (removed.deleted !== true) throw new Error(JSON.stringify(removed));
    const gone = await mcp().fail('memory_slot_get', { name: 'e2e-task' });
    if (!gone.includes('API 404')) throw new Error(gone);
    await mcp().call('memory_profile', { key: 'codename', value: 'e2e-agent' });
    const profile = await mcp().call('memory_profile', { key: 'codename' });
    has(profile, 'e2e-agent');
    const profiles = await mcp().call('memory_profile', {});
    has(profiles, 'codename');
    const leaseA = obj(await mcp().call('memory_lease', { name: 'e2e-lease', ttlSeconds: 120 }), 'lease');
    if (leaseA.acquired !== true) throw new Error(JSON.stringify(leaseA));
    const leaseB = obj(await mcp().call('memory_lease', { name: 'e2e-lease', ttlSeconds: 120 }), 'lease held');
    if (leaseB.acquired !== false) throw new Error(JSON.stringify(leaseB));
    const routine = obj(await mcp().call('memory_routine_run', { name: 'e2e-morning' }), 'routine');
    const steps = routine.steps as unknown[];
    if (!Array.isArray(steps) || !steps.includes('recall')) throw new Error(JSON.stringify(routine));
  });

  await report.step('mcp import and consolidate', async () => {
    const content = `E2E重复标记-${MARK.dup} 这三份应当收成一份`;
    const imported = obj(
      await mcp().call('memory_import', {
        memories: [
          { content, tags: ['e2e', 'dup-chain'], type: 'fact' },
          { content, tags: ['e2e', 'dup-chain'], type: 'fact' },
          { content, tags: ['e2e', 'dup-chain'], type: 'fact' },
        ],
      }),
      'import',
    );
    if (imported.imported !== 3) throw new Error(JSON.stringify(imported));
    const dry = obj(await mcp().call('memory_consolidate', { dryRun: true }), 'consolidate dry');
    if (Number(dry.groups) < 1 || Number(dry.merged) < 2) throw new Error(JSON.stringify(dry));
    const before = asMemories(obj(await mcp().call('memory_list', { tags: ['dup-chain'] }), 'dup list'), 'dup list');
    if (before.length !== 3) throw new Error(`dryRun deleted, left ${String(before.length)}`);
    const real = obj(await mcp().call('memory_consolidate', {}), 'consolidate');
    if (Number(real.merged) < 2) throw new Error(JSON.stringify(real));
    const after = asMemories(obj(await mcp().call('memory_list', { tags: ['dup-chain'] }), 'dup after'), 'dup after');
    if (after.length !== 1) throw new Error(`left ${String(after.length)}`);
  });

  await report.step('mcp reflect and crystallize', async () => {
    const app = primary(resources);
    for (let index = 0; index < 3; index += 1) {
      http(
        201,
        await call(app, 'POST', '/api/hooks/events', {
          token: resources.token,
          payload: {
            eventId: `e2e-crystal-evt-${String(index).padStart(4, '0')}`,
            hook: 'PostToolUse',
            toolName: 'Edit',
            sessionId: CRYSTAL_SESSION,
            project: PROJECT,
            content: `结晶观察-${MARK.crystal} ${String(index)}：调整了索引重建的批量大小，并核对召回结果`,
          },
        }),
        `crystal event ${String(index)}`,
      );
    }
    const first = obj(await mcp().call('memory_reflect', { project: PROJECT }), 'reflect');
    if (first.deduped !== false) throw new Error(JSON.stringify(first));
    const reflection = first.memory as { id?: string; content?: string };
    if (!reflection.content?.includes('反思') || !reflection.content.includes('lesson×')) {
      throw new Error(reflection.content ?? '');
    }
    const second = obj(await mcp().call('memory_reflect', { project: PROJECT }), 'reflect again');
    if (second.deduped !== true || (second.memory as { id?: string }).id !== reflection.id) {
      throw new Error(JSON.stringify(second));
    }
    const crystal = obj(await mcp().call('memory_crystallize', { sessionId: CRYSTAL_SESSION }), 'crystallize');
    const summary = crystal.memory as { id?: string; content?: string; origin?: string };
    if (summary.origin !== 'summary' || !summary.content?.includes('会话摘要') || !summary.content.includes(MARK.crystal)) {
      throw new Error(summary.content ?? '');
    }
    const again = obj(await mcp().call('memory_crystallize', { sessionId: CRYSTAL_SESSION }), 'crystallize again');
    if ((again.memory as { id?: string }).id !== summary.id) throw new Error('crystallize was not idempotent');
  });

  await report.step('mcp share, feed, mesh', async () => {
    const shared = obj(
      await mcp().call('memory_team_share', { id: id('share'), email: E2E_PEER.email }),
      'share',
    );
    if (shared.shared !== true) throw new Error(JSON.stringify(shared));
    await mcp().call('memory_team_share', { id: id('share'), email: E2E_PEER.email });
    const own = await mcp().call('memory_team_feed');
    lacks(own.text, MARK.share);
    const feed = obj(await resources.peerMcp!.call('memory_team_feed'), 'peer feed');
    const copies = asMemories(feed, 'feed').filter((memory) => String(memory.content ?? '').includes(MARK.share));
    if (copies.length !== 1) throw new Error(`feed copies ${String(copies.length)}`);
    lacks(String(copies[0]?.content), MARK.shareSecret);
    http(
      201,
      await call(resources.meshApp!, 'POST', '/api/memories', {
        token: resources.meshToken,
        payload: { content: `E2E网格标记-${MARK.mesh} 来自另一台服务`, tags: ['e2e', 'mesh'] },
      }),
      'mesh memory',
    );
    const synced = obj(
      await mcp().call('memory_mesh_sync', { peerUrl: resources.meshBase, peerToken: resources.meshToken }),
      'mesh',
    );
    if (Number(synced.imported) < 1 || Number(synced.peerCount) < 1) throw new Error(JSON.stringify(synced));
    const recalled = await mcp().call('memory_recall', { query: MARK.mesh });
    has(recalled, MARK.mesh);
    const blocked = await mcp().fail('memory_mesh_sync', { peerUrl: 'http://8.8.8.8', peerToken: 'x' });
    if (!blocked.includes('API 400')) throw new Error(blocked);
  });

  await report.step('mcp obsidian export and snapshot restore', async () => {
    const app = primary(resources);
    const vault = path.join(resources.workDir, 'vault');
    const exported = obj(await mcp().call('memory_obsidian_export', { dir: vault }), 'obsidian');
    const written = Number(exported.written);
    if (written < CORPUS.length) throw new Error(JSON.stringify(exported));
    const names = (await readdir(vault)).filter((name) => name.endsWith('.md'));
    if (names.length !== written) throw new Error(`files ${String(names.length)} written ${String(written)}`);
    let found = false;
    for (const name of names) {
      const text = await readFile(path.join(vault, name), 'utf8');
      if (text.includes(MARK.arch)) found = true;
    }
    if (!found) throw new Error('vault missed the architecture marker');

    const amber = http(
      201,
      await call(app, 'POST', '/api/memories', {
        token: resources.token,
        payload: { content: `E2E快照标记-${MARK.amber} 删除后要回来`, tags: ['e2e', 'snapshot'] },
      }),
      'amber',
    );
    const amberId = memId(amber, 'amber');
    const snap = obj(await mcp().call('memory_snapshot_create', { note: 'e2e-before-delete' }), 'snapshot');
    const snapshot = snap.snapshot as { id?: string; memoryCount?: number; note?: string };
    if (!snapshot.id || snapshot.note !== 'e2e-before-delete' || (snapshot.memoryCount ?? 0) < 1) {
      throw new Error(JSON.stringify(snap));
    }
    http(204, await call(app, 'DELETE', `/api/memories/${amberId}`, { token: resources.token }), 'delete amber');
    const missing = await call(app, 'GET', `/api/memories/${amberId}`, { token: resources.token });
    if (missing.status !== 404) throw new Error('amber still present');
    const restored = http(
      200,
      await call(app, 'POST', `/api/snapshots/${snapshot.id}/restore`, {
        token: resources.token,
        payload: { strategy: 'skip' },
      }),
      'restore',
    );
    if (Number(restored.imported) < 1) throw new Error(JSON.stringify(restored));
    const back = http(200, await call(app, 'GET', `/api/memories/${amberId}`, { token: resources.token }), 'amber back');
    if (!JSON.stringify(back).includes(MARK.amber)) throw new Error(JSON.stringify(back));
  });

  await report.step('mcp diagnose, auto_forget, heal', async () => {
    await mcp().call('memory_heal');
    const clean = await mcp().call('memory_diagnose');
    lacks(clean.text, '未配置 MEILI_URL');
    if (!clean.text.includes('ok: true')) throw new Error(clean.text);
    await mcp().call('memory_save', {
      content: `E2E过期标记-${MARK.expired} 这条已经过期`,
      tags: ['e2e', 'stale'],
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const recalled = await mcp().call('memory_recall', { query: MARK.expired });
    lacks(recalled.text, MARK.expired);
    const dirty = await mcp().call('memory_diagnose');
    has(dirty, '已过期未清理');
    const preview = obj(await mcp().call('memory_auto_forget', { dryRun: true }), 'auto_forget');
    if (Number(preview.expired) < 1 || preview.deleted !== 0) throw new Error(JSON.stringify(preview));
    const healed = obj(await mcp().call('memory_heal'), 'heal');
    const forget = healed.autoForget as { expired?: number; deleted?: number };
    if ((forget.expired ?? 0) < 1 || (forget.deleted ?? 0) < 1) throw new Error(JSON.stringify(healed));
    const after = await mcp().call('memory_diagnose');
    if (!after.text.includes('ok: true')) throw new Error(after.text);
    lacks(after.text, '已过期未清理');
  });

  await report.step('mcp batch_forget, governance_delete, lesson_delete, forget', async () => {
    const empty = await mcp().fail('memory_batch_forget', {});
    if (!empty.includes('requires ids')) throw new Error(empty);
    const disposable = obj(
      await mcp().call('memory_save', {
        content: `E2E可删标记-${MARK.disposable} 这条只给批量遗忘`,
        tags: ['e2e', 'disposable'],
        project: 'e2e-trash',
      }),
      'disposable',
    );
    const disposableId = memId(disposable, 'disposable');
    const dry = obj(await mcp().call('memory_batch_forget', { tags: ['disposable'], dryRun: true }), 'batch dry');
    if (dry.deleted !== 0 || Number(dry.matched) < 1) throw new Error(JSON.stringify(dry));
    const removed = obj(await mcp().call('memory_batch_forget', { ids: [disposableId] }), 'batch');
    if (Number(removed.deleted) < 1) throw new Error(JSON.stringify(removed));
    const disposableGone = await mcp().fail('memory_get', { id: disposableId });
    if (!disposableGone.includes('API 404')) throw new Error(disposableGone);

    const noFilter = await mcp().fail('memory_governance_delete', { reason: 'no filter' });
    if (!noFilter.includes('requires at least one filter')) throw new Error(noFilter);
    await mcp().call('memory_save', {
      content: `E2E治理标记-${MARK.govern} 这条只给治理删除`,
      tags: ['e2e', 'govern-me'],
      project: 'e2e-govern',
    });
    const preview = obj(
      await mcp().call('memory_governance_delete', { tags: ['govern-me'], dryRun: true, reason: 'e2e 演练' }),
      'govern dry',
    );
    if (preview.reason !== 'e2e 演练') throw new Error(JSON.stringify(preview));
    const previewResult = preview.result as { matched?: number; deleted?: number };
    if (previewResult.deleted !== 0 || (previewResult.matched ?? 0) < 1) throw new Error(JSON.stringify(preview));
    const governed = obj(
      await mcp().call('memory_governance_delete', { tags: ['govern-me'], reason: 'e2e 清理' }),
      'govern',
    );
    if (Number((governed.result as { deleted?: number }).deleted) < 1) throw new Error(JSON.stringify(governed));

    const notLesson = await mcp().fail('memory_lesson_delete', { id: id('arch') });
    if (!notLesson.includes('is not a lesson')) throw new Error(notLesson);
    const lesson = obj(
      await mcp().call('memory_lesson_save', {
        content: `E2E待删教训-${MARK.lessonDrop} 这条教训会被删掉`,
        tags: ['e2e'],
      }),
      'lesson',
    );
    if ((lesson.memory as { type?: string }).type !== 'lesson') throw new Error(JSON.stringify(lesson));
    const lessonId = memId(lesson, 'lesson');
    const lessonGone = obj(await mcp().call('memory_lesson_delete', { id: lessonId }), 'lesson delete');
    if (lessonGone.deleted !== true) throw new Error(JSON.stringify(lessonGone));

    const single = obj(
      await mcp().call('memory_save', { content: `E2E单删标记-${MARK.forget} 这条只删一条` }),
      'forget target',
    );
    const forgotten = obj(await mcp().call('memory_forget', { id: memId(single, 'forget') }), 'forget');
    if (forgotten.deleted !== true) throw new Error(JSON.stringify(forgotten));
  });

  await report.step('mcp audit', async () => {
    const audit = obj(await mcp().call('memory_audit', { limit: 200 }), 'audit');
    const actions = new Set((audit.entries as Array<{ action?: string }>).map((entry) => entry.action));
    for (const action of ['memory.delete', 'memory.share', 'snapshot.restore', 'admin.heal', 'memory.import', 'memory.batch_forget']) {
      if (!actions.has(action)) throw new Error(`missing ${action}; saw ${[...actions].join(', ')}`);
    }
  });

  await report.step('mcp profiles core and standard', async () => {
    const core = McpClient.start(resources.base, resources.profileToken, { AGENT_RECALL_MCP_PROFILE: 'core' });
    const standard = McpClient.start(resources.base, resources.profileToken, { AGENT_RECALL_MCP_PROFILE: 'standard' });
    try {
      await core.initialize();
      const coreNames = await core.toolNames();
      const coreDiff = diffToolNames(coreNames, CORE_TOOLS);
      if (coreDiff) throw new Error(`core ${coreDiff}`);
      const hidden = await core.fail('memory_lease', { name: 'x', ttlSeconds: 10 });
      if (!hidden.includes('AGENT_RECALL_MCP_PROFILE=full')) throw new Error(hidden);
      const saved = await core.call('memory_save', { content: `E2E核心面标记-${MARK.core} core profile 可写` });
      has(saved, MARK.core);

      await standard.initialize();
      const standardDiff = diffToolNames(await standard.toolNames(), standardTools());
      if (standardDiff) throw new Error(`standard ${standardDiff}`);
      const stillHidden = await standard.fail('memory_lease', { name: 'y', ttlSeconds: 10 });
      if (!stillHidden.includes('AGENT_RECALL_MCP_PROFILE=full')) throw new Error(stillHidden);
      const checkpoint = await standard.call('memory_checkpoint', { name: 'e2e-std-ckpt', state: { phase: 'standard' } });
      has(checkpoint, 'e2e-std-ckpt');
    } finally {
      core.close();
      standard.close();
    }
  });

  await report.step('every full-profile tool was called', async () => {
    const missing = FULL_TOOLS.filter((name) => !resources.mcp?.called.has(name));
    if (missing.length > 0) throw new Error(`uncovered: ${missing.join(', ')}`);
  });

  await report.step('revoked token is rejected', async () => {
    const app = primary(resources);
    const revoked = http(
      200,
      await call(app, 'POST', `/api/tokens/${resources.tokenId}/revoke`, { cookie: resources.cookie }),
      'revoke',
    );
    if (!(revoked.token as { revokedAt?: string | null }).revokedAt) throw new Error(JSON.stringify(revoked));
    const denied = await mcp().fail('memory_recall', { query: MARK.arch });
    if (denied !== 'Unauthorized') throw new Error(denied);
  });

  await report.step('data survives restart', async () => {
    resources.mcp?.close();
    resources.peerMcp?.close();
    resources.mcp = null;
    resources.peerMcp = null;
    await resources.app?.close();
    resources.app = null;
    const config = resources.config;
    if (!config) throw new Error('missing config');
    resources.app = await openTestApp({
      dataDir: resources.dataDir,
      config,
      retrieval: createRetrieval(config),
    });
    const login = await call(resources.app, 'POST', '/api/auth/login', {
      payload: { email: E2E_ACCOUNT.email, password: E2E_ACCOUNT.password },
    });
    http(200, login, 'relogin');
    const cookie = sessionCookie(login.headers);
    const listed = await call(resources.app, 'GET', '/api/memories', { cookie });
    const text = JSON.stringify(listed.body);
    if (!text.includes(MARK.arch)) throw new Error('architecture memory did not survive restart');
    lacks(text, MARK.disposable);
    lacks(text, MARK.govern);
    lacks(text, MARK.forget);
    const denied = await call(resources.app, 'POST', '/api/memories/recall', {
      token: resources.token,
      payload: { query: MARK.arch },
    });
    if (denied.status !== 401) throw new Error(`revoked token HTTP ${String(denied.status)} after restart`);
  });
}

async function main(): Promise<number> {
  clearProxy();
  console.log('agent-recall e2e');
  console.log(`account  ${E2E_ACCOUNT.email}`);
  console.log(`peer     ${E2E_PEER.email}`);
  console.log(`corpus   ${String(CORPUS.length)} memories in ${PROJECT}`);
  const report = new Report();
  const resources = new Resources();
  try {
    await scenario(report, resources);
  } catch (error) {
    if (!(error instanceof Stop)) {
      console.error(error instanceof Error ? (error.stack ?? error.message) : error);
      report.failed += 1;
    }
  } finally {
    await resources.close();
    report.summary();
  }
  return report.failed === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
