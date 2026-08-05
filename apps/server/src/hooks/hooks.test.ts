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
const hooksDir = path.join(repoRoot, 'hooks');

function scriptFromManifest(command: string): string {
  const match = /"\$\{CLAUDE_PLUGIN_ROOT\}([^"]+)"/.exec(command);
  if (!match?.[1]) throw new Error(`unrecognized hook command: ${command}`);
  return path.join(hooksDir, match[1].replace(/^\//, ''));
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

describe('claude-shaped hooks', () => {
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

  it('dedupes a live event, spools when the service is down, and drains one recallable hook memory', async () => {
    const manifest = JSON.parse(readFileSync(path.join(hooksDir, 'hooks.json'), 'utf8')) as {
      hooks: Record<string, { hooks: { type: string; command: string }[] }[]>;
    };
    const events = ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'SessionEnd'];
    for (const event of events) {
      const hook = manifest.hooks[event]?.[0]?.hooks[0];
      expect(hook?.type).toBe('command');
      expect(scriptFromManifest(hook?.command ?? '')).toContain('.mjs');
    }

    const sessionScript = scriptFromManifest(manifest.hooks.SessionStart?.[0]?.hooks[0]?.command ?? '');
    const payload = { session_id: 'sess-alpha', event_id: 'alpha-event-0001', note: 'HOOK_SESSION_ALPHA' };
    const first = await runNode(sessionScript, payload, hookEnv());
    const second = await runNode(sessionScript, payload, hookEnv());
    expect(first.code).toBe(0);
    expect(second.code).toBe(0);

    const others: Array<[string, string, string]> = [
      ['UserPromptSubmit', 'prompt-event-0001', 'HOOK_PROMPT_GAMMA'],
      ['PostToolUse', 'tool-event-0001', 'HOOK_TOOL_DELTA'],
      ['SessionEnd', 'end-event-0001', 'HOOK_END_EPSILON'],
    ];
    for (const [event, eventId, note] of others) {
      const script = scriptFromManifest(manifest.hooks[event]?.[0]?.hooks[0]?.command ?? '');
      const result = await runNode(script, { session_id: 'sess-alpha', event_id: eventId, note }, hookEnv());
      expect(result.code).toBe(0);
    }

    const listed = await call(app, 'GET', '/api/memories', { token });
    const memories = listed.body?.memories as { content: string; origin: string }[];
    const alpha = memories.filter((item) => item.content.includes('HOOK_SESSION_ALPHA'));
    expect(alpha).toHaveLength(1);
    expect(alpha[0]?.origin).toBe('hook');
    expect(memories.filter((item) => item.origin === 'hook')).toHaveLength(4);

    const spoolPayload = { session_id: 'sess-beta', event_id: 'beta-event-0001', note: 'HOOK_SPOOL_BETA' };
    const spooled = await runNode(sessionScript, spoolPayload, hookEnv('http://127.0.0.1:9'));
    expect(spooled.code).toBe(0);
    const spoolFile = path.join(spoolDir, 'events.jsonl');
    const spoolText = readFileSync(spoolFile, 'utf8');
    expect(spoolText).toContain('HOOK_SPOOL_BETA');
    const beforeDrain = await call(app, 'GET', '/api/memories', { token });
    expect(JSON.stringify(beforeDrain.body)).not.toContain('HOOK_SPOOL_BETA');

    const drained = await runNode(path.join(hooksDir, 'drain.mjs'), {}, hookEnv());
    expect(drained.code).toBe(0);
    expect(JSON.parse(drained.stdout).delivered).toBe(1);
    const after = await call(app, 'GET', '/api/memories', { token });
    const spoolHits = (after.body?.memories as { content: string; origin: string }[]).filter((item) =>
      item.content.includes('HOOK_SPOOL_BETA'),
    );
    expect(spoolHits).toHaveLength(1);
    expect(spoolHits[0]?.origin).toBe('hook');

    const recalled = await call(app, 'POST', '/api/memories/recall', { token, payload: { query: 'HOOK_SPOOL_BETA' } });
    const recalledHit = (recalled.body?.memories as { content: string }[]).find((item) =>
      item.content.includes('HOOK_SPOOL_BETA'),
    );
    expect(recalledHit?.content).toContain('HOOK_SPOOL_BETA');

    const drainedAgain = await runNode(path.join(hooksDir, 'drain.mjs'), {}, hookEnv());
    expect(JSON.parse(drainedAgain.stdout).delivered).toBe(0);
    const still = await call(app, 'GET', '/api/memories', { token });
    expect(
      (still.body?.memories as { content: string }[]).filter((item) => item.content.includes('HOOK_SPOOL_BETA')),
    ).toHaveLength(1);
  });
});
