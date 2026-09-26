import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRetrieval } from '../retrieval/ports.js';
import { startProtocolStandin, type ProtocolStandIn } from '../retrieval/protocol-standin.js';
import { call, makeDataDir, openTestApp, removeDataDir, sessionCookie, testConfig } from '../test/app-harness.js';

const mcpRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../mcp');

interface RpcMessage {
  id?: number | string | null;
  result?: {
    protocolVersion?: string;
    tools?: { name: string; inputSchema?: { required?: string[] } }[];
    content?: { text?: string }[];
  };
  error?: { code?: number; message?: string };
}

function startMcp(url: string, token: string, extraEnv: NodeJS.ProcessEnv = {}): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: mcpRoot,
    env: { ...process.env, AGENT_RECALL_URL: url, AGENT_RECALL_TOKEN: token, ...extraEnv },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function speak(child: ChildProcessWithoutNullStreams) {
  let buffer = '';
  const waiters: Array<(message: RpcMessage) => void> = [];
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    let index = buffer.indexOf('\n');
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf('\n');
      if (!line) continue;
      const waiter = waiters.shift();
      if (waiter) waiter(JSON.parse(line) as RpcMessage);
    }
  });
  let seq = 0;
  return {
    request(method: string, params: Record<string, unknown> = {}) {
      const id = ++seq;
      const message = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      const response = new Promise<RpcMessage>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 8000);
        waiters.push((value) => {
          clearTimeout(timer);
          resolve(value);
        });
      });
      child.stdin.write(`${message}\n`);
      return response;
    },
    notify(method: string) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
    },
  };
}

describe('mcp stdio', () => {
  let dataDir = '';
  let app: FastifyInstance;
  let standin: ProtocolStandIn;
  let base = '';
  let cookie = '';

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
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('server did not bind');
    base = `http://127.0.0.1:${String(address.port)}`;
    const registered = await call(app, 'POST', '/api/auth/register', {
      payload: { email: 'mcp@example.com', password: 'password-mcp' },
    });
    cookie = sessionCookie(registered.headers);
  });

  afterAll(async () => {
    await app.close();
    await standin.close();
    await removeDataDir(dataDir);
  });

  it('saves through memory_save and finds it with memory_smart_search, then rejects a revoked token', async () => {
    const created = await call(app, 'POST', '/api/tokens', { cookie, payload: { name: 'stdio' } });
    const secret = String(created.body?.secret);
    const tokenId = (created.body?.token as { id: string }).id;
    const child = startMcp(base, secret);
    const rpc = speak(child);
    try {
      const initialized = await rpc.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '0' },
      });
      expect(initialized.result?.protocolVersion ?? initialized.result).toBeTruthy();
      rpc.notify('notifications/initialized');
      const tools = await rpc.request('tools/list');
      const names = (tools.result?.tools ?? []).map((tool) => tool.name);
      // agentmemory 完整工具面对齐（52）+ 本地超集
      expect(names).toEqual(
        expect.arrayContaining([
          'memory_save',
          'memory_remember',
          'memory_lesson_save',
          'memory_update',
          'memory_import',
          'memory_recall',
          'memory_smart_search',
          'memory_context',
          'memory_list',
          'memory_get',
          'memory_versions',
          'memory_sessions',
          'memory_session_timeline',
          'memory_stats',
          'memory_export',
          'memory_forget',
          'memory_batch_forget',
          'memory_auto_forget',
          'memory_action_create',
          'memory_action_update',
          'memory_audit',
          'memory_checkpoint',
          'memory_claude_bridge_sync',
          'memory_commit_lookup',
          'memory_commits',
          'memory_compress_file',
          'memory_consolidate',
          'memory_crystallize',
          'memory_diagnose',
          'memory_facet_query',
          'memory_facet_tag',
          'memory_file_history',
          'memory_frontier',
          'memory_governance_delete',
          'memory_graph_query',
          'memory_heal',
          'memory_insight_list',
          'memory_lease',
          'memory_lesson_delete',
          'memory_lesson_recall',
          'memory_next',
          'memory_obsidian_export',
          'memory_patterns',
          'memory_profile',
          'memory_reflect',
          'memory_relations',
          'memory_routine_run',
          'memory_sentinel_create',
          'memory_sentinel_trigger',
          'memory_signal_read',
          'memory_signal_send',
          'memory_sketch_create',
          'memory_sketch_promote',
          'memory_slot_append',
          'memory_slot_create',
          'memory_slot_delete',
          'memory_slot_get',
          'memory_slot_list',
          'memory_slot_replace',
          'memory_snapshot_create',
          'memory_team_feed',
          'memory_team_share',
          'memory_timeline',
          'memory_verify',
          'memory_vision_search',
        ]),
      );
      const saveTool = tools.result?.tools?.find((tool) => tool.name === 'memory_save');
      const recallTool = tools.result?.tools?.find((tool) => tool.name === 'memory_recall');
      expect(saveTool?.inputSchema?.required).toContain('content');
      expect(recallTool?.inputSchema?.required).toContain('query');

      const saved = await rpc.request('tools/call', {
        name: 'memory_save',
        arguments: { content: 'MCP保存的星图', type: 'fact', tags: ['mcp-test'], project: 'demo' },
      });
      expect(saved.result?.content?.[0]?.text).toContain('MCP保存的星图');
      const savedPayload = JSON.parse(saved.result!.content![0]!.text!) as { memory: { id: string } };

      const searched = await rpc.request('tools/call', {
        name: 'memory_smart_search',
        arguments: { query: '星图' },
      });
      expect(searched.result?.content?.[0]?.text).toContain('MCP保存的星图');

      // 生命周期：update → versions → get → context → stats → forget
      const updated = await rpc.request('tools/call', {
        name: 'memory_update',
        arguments: { id: savedPayload.memory.id, content: 'MCP保存的星图-第二版' },
      });
      const updatedPayload = JSON.parse(updated.result!.content![0]!.text!) as {
        memory: { id: string; version: number };
      };
      expect(updatedPayload.memory.version).toBe(2);
      const versions = await rpc.request('tools/call', {
        name: 'memory_versions',
        arguments: { id: savedPayload.memory.id },
      });
      expect(versions.result?.content?.[0]?.text).toContain('MCP保存的星图');
      const ctx = await rpc.request('tools/call', {
        name: 'memory_context',
        arguments: { query: '星图', tokenBudget: 500 },
      });
      expect(ctx.result?.content?.[0]?.text).toContain('星图');
      const stats = await rpc.request('tools/call', { name: 'memory_stats' });
      expect(stats.result?.content?.[0]?.text).toContain('total');
      const forgotten = await rpc.request('tools/call', {
        name: 'memory_forget',
        arguments: { id: updatedPayload.memory.id },
      });
      if (!forgotten.result) console.error('memory_forget error:', JSON.stringify(forgotten.error));
      expect(forgotten.result?.content?.[0]?.text).toContain('deleted');

      // 子系统工具端到端：KV checkpoint/lease/signal、facet、graph、diagnose、snapshot
      const checkpoint = await rpc.request('tools/call', {
        name: 'memory_checkpoint',
        arguments: { name: 'it-checkpoint', state: { step: 1 } },
      });
      expect(checkpoint.result?.content?.[0]?.text).toContain('it-checkpoint');

      const leaseA = await rpc.request('tools/call', {
        name: 'memory_lease',
        arguments: { name: 'it-lease', ttlSeconds: 60 },
      });
      expect(leaseA.result?.content?.[0]?.text).toContain('"acquired":true');
      const leaseB = await rpc.request('tools/call', {
        name: 'memory_lease',
        arguments: { name: 'it-lease', ttlSeconds: 60 },
      });
      expect(leaseB.result?.content?.[0]?.text).toContain('"acquired":false');

      await rpc.request('tools/call', {
        name: 'memory_signal_send',
        arguments: { name: 'deploy', data: { ok: true } },
      });
      const signal = await rpc.request('tools/call', {
        name: 'memory_signal_read',
        arguments: { name: 'deploy' },
      });
      expect(signal.result?.content?.[0]?.text).toContain('"ok":true');

      await call(app, 'POST', '/api/memories', {
        token: secret,
        payload: { content: '图谱节点目标-碧玺', tags: ['graph-it'], project: 'graph-demo' },
      });
      const graph = await rpc.request('tools/call', {
        name: 'memory_graph_query',
        arguments: { query: 'graph-it' },
      });
      expect(graph.result?.content?.[0]?.text).toContain('graph-it');

      const diagnose = await rpc.request('tools/call', { name: 'memory_diagnose' });
      expect(diagnose.result?.content?.[0]?.text).toMatch(/ok|problems/);

      const snapshot = await rpc.request('tools/call', {
        name: 'memory_snapshot_create',
        arguments: { note: 'it' },
      });
      expect(snapshot.result?.content?.[0]?.text).toContain('memoryCount');

      await call(app, 'POST', `/api/tokens/${tokenId}/revoke`, { cookie });
      const denied = await rpc.request('tools/call', {
        name: 'memory_recall',
        arguments: { query: '星图' },
      });
      expect(denied.error?.message).toBe('Unauthorized');
    } finally {
      child.kill('SIGTERM');
    }
  });

  it('serves the server tool catalog without local file tools', async () => {
    const created = await call(app, 'POST', '/api/tokens', { cookie, payload: { name: 'catalog' } });
    const secret = String(created.body?.secret);
    const listed = await call(app, 'GET', '/api/mcp/tools?profile=full', { token: secret });
    expect(listed.status).toBe(200);
    const names = ((listed.body as { tools?: { name: string }[] }).tools ?? []).map((tool) => tool.name);
    expect(names).toHaveLength(62);
    expect(names).not.toContain('memory_compress_file');
    expect(names).not.toContain('memory_claude_bridge_sync');
    expect(names).not.toContain('memory_obsidian_export');
    const core = await call(app, 'GET', '/api/mcp/tools?profile=core', { token: secret });
    expect((core.body as { tools?: unknown[] }).tools).toHaveLength(12);
  });

  it('narrows the tool surface with AGENT_RECALL_MCP_PROFILE=core and rejects hidden tools', async () => {
    const created = await call(app, 'POST', '/api/tokens', { cookie, payload: { name: 'stdio-profile' } });
    const secret = String(created.body?.secret);
    const child = startMcp(base, secret, { AGENT_RECALL_MCP_PROFILE: 'core' });
    const rpc = speak(child);
    try {
      await rpc.request('initialize', { protocolVersion: '2024-11-05' });
      const tools = await rpc.request('tools/list');
      const names = (tools.result?.tools ?? []).map((tool) => tool.name);
      expect(names).toHaveLength(12);
      expect(names).toContain('memory_save');
      expect(names).not.toContain('memory_lease');

      // 隐藏工具调用被拒绝并提示切换方式
      const hidden = await rpc.request('tools/call', {
        name: 'memory_lease',
        arguments: { name: 'x', ttlSeconds: 10 },
      });
      expect(hidden.error?.message).toContain('AGENT_RECALL_MCP_PROFILE=full');

      // 核心工具正常工作
      const saved = await rpc.request('tools/call', {
        name: 'memory_save',
        arguments: { content: 'core profile 写入验证' },
      });
      expect(saved.result?.content?.[0]?.text).toContain('core profile 写入验证');
    } finally {
      child.kill('SIGTERM');
    }
  });
});
