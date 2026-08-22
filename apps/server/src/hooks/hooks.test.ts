import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRetrieval } from '../retrieval/ports.js';
import { startProtocolStandin, type ProtocolStandIn } from '../retrieval/protocol-standin.js';
import { call, makeDataDir, openTestApp, removeDataDir, sessionCookie, testConfig } from '../test/app-harness.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const pluginDir = path.join(repoRoot, 'plugins', 'claude-code');

function scriptFromManifest(command: string): string {
  const match = /"\$\{CLAUDE_PLUGIN_ROOT\}([^"]+)"/.exec(command);
  if (!match?.[1]) throw new Error(`unrecognized hook command: ${command}`);
  return path.join(pluginDir, match[1].replace(/^\//, ''));
}

function runNode(script: string, payload: unknown, env: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(JSON.stringify(payload));
  });
}

describe('claude-code plugin hooks', () => {
  let dataDir = '';
  let spoolDir = '';
  let app: FastifyInstance;
  let standin: ProtocolStandIn;
  let base = '';
  let token = '';

  beforeAll(async () => {
    standin = await startProtocolStandin();
    dataDir = await makeDataDir();
    spoolDir = await mkdtemp(path.join(tmpdir(), 'agent-recall-spool-'));
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
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('server did not bind');
    base = `http://127.0.0.1:${String(address.port)}`;
    const registered = await call(app, 'POST', '/api/auth/register', {
      payload: { email: 'hook@example.com', password: 'password-hook' },
    });
    const created = await call(app, 'POST', '/api/tokens', {
      cookie: sessionCookie(registered.headers),
      payload: { name: 'hooks' },
    });
    token = String(created.body?.secret);
  });

  afterAll(async () => {
    await app.close();
    await standin.close();
    await removeDataDir(dataDir);
    await rm(spoolDir, { recursive: true, force: true });
  });

  function hookEnv(url = base): NodeJS.ProcessEnv {
    return {
      ...process.env,
      AGENT_RECALL_URL: url,
      AGENT_RECALL_TOKEN: token,
      AGENT_RECALL_SPOOL_DIR: spoolDir,
    };
  }

  it('injects recalled context on prompt submit, captures tool events, and summarizes on session end', async () => {
    const manifest = JSON.parse(readFileSync(path.join(pluginDir, 'hooks', 'hooks.json'), 'utf8')) as {
      hooks: Record<string, { hooks: { type: string; command: string }[] }[]>;
    };
    const events = ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'SessionEnd'];
    for (const event of events) {
      const hook = manifest.hooks[event]?.[0]?.hooks[0];
      expect(hook?.type).toBe('command');
      expect(scriptFromManifest(hook?.command ?? '')).toContain('.mjs');
    }

    // 先人工沉淀一条项目记忆，供召回注入命中
    await call(app, 'POST', '/api/memories', {
      token,
      payload: { content: '项目约定：检索融合用 RRF，k=60（HOOK_INJECT_TARGET）', type: 'architecture', project: 'demo-proj' },
    });

    const sessionId = 'sess-plugin-it';
    const cwd = '/tmp/demo-proj';

    // SessionStart：注册事件 + 注入项目上下文
    const startScript = scriptFromManifest(manifest.hooks.SessionStart![0]!.hooks[0]!.command);
    const started = await runNode(startScript, { session_id: sessionId, cwd, source: 'startup' }, hookEnv());
    expect(started.code).toBe(0);
    expect(started.stdout).toContain('additionalContext');
    expect(started.stdout).toContain('HOOK_INJECT_TARGET');

    // UserPromptSubmit：只召回注入，不落库 prompt
    const promptScript = scriptFromManifest(manifest.hooks.UserPromptSubmit![0]!.hooks[0]!.command);
    const prompted = await runNode(promptScript, { session_id: sessionId, cwd, prompt: 'RRF 融合参数是多少' }, hookEnv());
    expect(prompted.code).toBe(0);
    expect(prompted.stdout).toContain('additionalContext');
    expect(prompted.stdout).toContain('HOOK_INJECT_TARGET');

    // PostToolUse：工具观察入库（带 sessionId/project/toolName）
    const toolScript = scriptFromManifest(manifest.hooks.PostToolUse![0]!.hooks[0]!.command);
    const tooled = await runNode(
      toolScript,
      {
        session_id: sessionId,
        cwd,
        tool_name: 'Edit',
        tool_input: { file_path: 'src/retrieval/rrf.ts' },
        tool_response: { ok: true, detail: 'k adjusted to 60' },
      },
      hookEnv(),
    );
    expect(tooled.code).toBe(0);

    // SessionEnd：事件入库，服务端自动生成会话摘要
    const endScript = scriptFromManifest(manifest.hooks.SessionEnd![0]!.hooks[0]!.command);
    const ended = await runNode(endScript, { session_id: sessionId, cwd, reason: 'user_exit' }, hookEnv());
    expect(ended.code).toBe(0);

    const timeline = await call(app, 'GET', `/api/sessions/${sessionId}`, { token });
    const items = timeline.body?.memories as Array<{ origin: string; content: string; sessionId: string }>;
    // SessionStart + PostToolUse + SessionEnd 三条事件（UserPromptSubmit 不落库）
    const hookEvents = items.filter((m) => m.origin === 'hook');
    expect(hookEvents.length).toBe(3);
    expect(items.some((m) => m.content.includes('RRF 融合参数是多少'))).toBe(false);
    expect(items.some((m) => m.content.includes('[PostToolUse] Edit'))).toBe(true);
    const summary = items.find((m) => m.origin === 'summary');
    expect(summary).toBeTruthy();
    expect(summary!.content).toContain('会话摘要');

    // 断网落 spool，恢复后 drain 补投
    const spooled = await runNode(
      toolScript,
      {
        session_id: sessionId,
        cwd,
        tool_name: 'Bash',
        tool_input: { command: 'pnpm test' },
        tool_response: '22 passed HOOK_SPOOL_MARKER',
      },
      hookEnv('http://127.0.0.1:9'),
    );
    expect(spooled.code).toBe(0);
    expect(readFileSync(path.join(spoolDir, 'events.jsonl'), 'utf8')).toContain('HOOK_SPOOL_MARKER');

    const drained = await runNode(path.join(pluginDir, 'scripts', 'drain.mjs'), {}, hookEnv());
    expect(drained.code).toBe(0);
    expect(JSON.parse(drained.stdout).delivered).toBe(1);
    const after = await call(app, 'GET', `/api/sessions/${sessionId}`, { token });
    expect(JSON.stringify(after.body)).toContain('HOOK_SPOOL_MARKER');
  });
});
