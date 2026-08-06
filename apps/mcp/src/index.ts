#!/usr/bin/env node
import { createStdioTransport, JsonRpcError } from './stdio.js';

const TOOLS = [
  {
    name: 'memory_save',
    description: 'Save a memory for the token owner.',
    inputSchema: {
      type: 'object',
      properties: { content: { type: 'string', description: 'Memory text' } },
      required: ['content'],
    },
  },
  {
    name: 'memory_recall',
    description: 'Recall memories with lexical and vector fusion.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results' },
      },
      required: ['query'],
    },
  },
  {
    name: 'memory_smart_search',
    description: 'Search memories with the same lexical and vector fusion as memory_recall.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results' },
      },
      required: ['query'],
    },
  },
];

function baseUrl(): string {
  return (process.env.AGENT_RECALL_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
}

function token(): string {
  return process.env.AGENT_RECALL_TOKEN ?? '';
}

async function api(path: string, init?: { method?: string; body?: unknown }): Promise<unknown> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token()}`,
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  const json: unknown = text ? (JSON.parse(text) as unknown) : null;
  if (res.status === 401) throw new JsonRpcError(-32001, 'Unauthorized');
  if (!res.ok) throw new JsonRpcError(-32603, `API ${String(res.status)}`);
  return json;
}

function textResult(payload: unknown): { content: Array<{ type: string; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new JsonRpcError(-32602, `${key} is required`);
  }
  return value;
}

async function callTool(params: Record<string, unknown>): Promise<unknown> {
  const name = params.name;
  const args =
    typeof params.arguments === 'object' && params.arguments !== null
      ? (params.arguments as Record<string, unknown>)
      : {};
  if (name === 'memory_save') {
    const content = requiredString(args, 'content');
    return textResult(await api('/api/memories', { method: 'POST', body: { content } }));
  }
  if (name === 'memory_recall' || name === 'memory_smart_search') {
    const query = requiredString(args, 'query');
    const path = name === 'memory_recall' ? '/api/memories/recall' : '/api/memories/smart-search';
    const body: { query: string; limit?: number } = { query };
    if (typeof args.limit === 'number') body.limit = args.limit;
    return textResult(await api(path, { method: 'POST', body }));
  }
  throw new JsonRpcError(-32602, `Unknown tool: ${String(name)}`);
}

async function handle(method: string, params: Record<string, unknown>): Promise<unknown> {
  if (method === 'initialize') {
    const protocolVersion = typeof params.protocolVersion === 'string' ? params.protocolVersion : '2024-11-05';
    return {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'agent-recall', version: '0.1.0' },
    };
  }
  if (method === 'notifications/initialized' || method === 'initialized') return {};
  if (method === 'tools/list') {
    await api('/api/auth/me');
    return { tools: TOOLS };
  }
  if (method === 'tools/call') {
    await api('/api/auth/me');
    return callTool(params);
  }
  throw new JsonRpcError(-32601, `Method not found: ${method}`);
}

createStdioTransport((method, params) => handle(method, params)).start();
