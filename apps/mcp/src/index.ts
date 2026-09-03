#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import nodePath from 'node:path';
import { createStdioTransport, JsonRpcError } from './stdio.js';

/**
 * stdio MCP entry. Server-owned tools come from GET /api/mcp/tools and run
 * through POST /api/mcp/tools/call, so the server can add tools without a new
 * npm release. Tools that touch the user's computer stay in this package.
 */

const LOCAL_TOOL_NAMES = ['memory_compress_file', 'memory_claude_bridge_sync', 'memory_obsidian_export'] as const;

const LOCAL_TOOLS = [
  {
    name: 'memory_compress_file',
    description:
      'Read a local source file (max 200KB), extract its outline (exports/functions/classes/headings), and save it as a ' +
      'type "pattern" memory tagged "file-summary". Query it later with memory_file_history.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file to summarize' },
        project: { type: 'string', description: 'Project name to scope the summary' },
      },
      required: ['path'],
    },
  },
  {
    name: 'memory_claude_bridge_sync',
    description:
      'Sync between a local MEMORY.md file and the memory store. direction "from" imports bullet/heading entries as memories ' +
      'tagged "claude-bridge" (duplicates skipped); direction "to" renders all claude-bridge memories back into the file as markdown.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the MEMORY.md file (default: ./MEMORY.md)' },
        direction: {
          type: 'string',
          enum: ['from', 'to'],
          description: '"from" imports the file into the store; "to" writes the store back to the file',
        },
      },
      required: ['direction'],
    },
  },
  {
    name: 'memory_obsidian_export',
    description:
      'Export every memory as an individual markdown file with YAML frontmatter into a local directory (Obsidian-compatible vault). ' +
      'For a machine-readable JSON bundle, use memory_export.',
    inputSchema: {
      type: 'object',
      properties: { dir: { type: 'string', description: 'Target directory (created recursively)' } },
      required: ['dir'],
    },
  },
];

type ToolProfile = 'core' | 'standard' | 'full';

function profile(): ToolProfile {
  const raw = (process.env.AGENT_RECALL_MCP_PROFILE ?? 'full').trim().toLowerCase();
  return raw === 'core' || raw === 'standard' ? raw : 'full';
}

function baseUrl(): string {
  return (process.env.AGENT_RECALL_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
}

function token(): string {
  return process.env.AGENT_RECALL_TOKEN ?? '';
}

interface ApiResponse {
  status: number;
  json: unknown;
}

async function apiRaw(path: string, init?: { method?: string; body?: unknown }): Promise<ApiResponse> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
      authorization: `Bearer ${token()}`,
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      throw new JsonRpcError(-32603, 'API returned a non-JSON body');
    }
  }
  if (res.status === 401) throw new JsonRpcError(-32001, 'Unauthorized');
  return { status: res.status, json };
}

async function api(path: string, init?: { method?: string; body?: unknown }): Promise<unknown> {
  const { status, json } = await apiRaw(path, init);
  if (status < 200 || status >= 300) throw new JsonRpcError(-32603, `API ${String(status)}`);
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

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new JsonRpcError(-32602, `${key} must be a string`);
  return value;
}

function optionalEnum(args: Record<string, unknown>, key: string, values: readonly string[]): string | undefined {
  const value = optionalString(args, key);
  if (value === undefined) return undefined;
  if (!values.includes(value)) {
    throw new JsonRpcError(-32602, `${key} must be one of: ${values.join(', ')}`);
  }
  return value;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FORBIDDEN_PATH_PREFIXES = ['/etc', '/usr', '/system', 'c:\\windows'];
const MAX_FILE_BYTES = 200 * 1024;

function resolveSafePath(input: string): string {
  const resolved = nodePath.resolve(input);
  const lower = resolved.toLowerCase();
  for (const prefix of FORBIDDEN_PATH_PREFIXES) {
    if (lower === prefix || lower.startsWith(prefix + nodePath.sep)) {
      throw new JsonRpcError(-32602, `path points to a protected system directory: ${input}`);
    }
  }
  return resolved;
}

async function readFileCapped(path: string): Promise<[string, boolean]> {
  const buf = await readFile(path);
  if (buf.byteLength <= MAX_FILE_BYTES) return [buf.toString('utf8'), false];
  return [buf.subarray(0, MAX_FILE_BYTES).toString('utf8'), true];
}

function isLocalTool(name: string): boolean {
  return (LOCAL_TOOL_NAMES as readonly string[]).includes(name);
}

function hiddenMessage(name: string): string {
  return `Tool ${name} is hidden by AGENT_RECALL_MCP_PROFILE=${profile()}; set AGENT_RECALL_MCP_PROFILE=full to enable it`;
}

interface RemoteTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

async function listRemoteTools(): Promise<RemoteTool[]> {
  const { status, json } = await apiRaw(`/api/mcp/tools?profile=${encodeURIComponent(profile())}`);
  if (status === 404) {
    throw new JsonRpcError(-32603, 'server has no /api/mcp/tools; upgrade the agent-recall server');
  }
  if (status < 200 || status >= 300) throw new JsonRpcError(-32603, `API ${String(status)}`);
  const tools = typeof json === 'object' && json !== null ? (json as { tools?: unknown }).tools : undefined;
  if (!Array.isArray(tools)) throw new JsonRpcError(-32603, 'server tool catalog is invalid');
  return tools as RemoteTool[];
}

async function callRemoteTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const { status, json } = await apiRaw('/api/mcp/tools/call', {
    method: 'POST',
    body: { name, arguments: args, profile: profile() },
  });
  if (status === 404) {
    throw new JsonRpcError(-32603, 'server has no /api/mcp/tools/call; upgrade the agent-recall server');
  }
  if (status < 200 || status >= 300) {
    const record = typeof json === 'object' && json !== null ? (json as { error?: { message?: string; rpcCode?: number } }) : {};
    const rpcCode = typeof record.error?.rpcCode === 'number' ? record.error.rpcCode : -32603;
    const message = record.error?.message ?? `API ${String(status)}`;
    throw new JsonRpcError(rpcCode, message);
  }
  return json;
}

async function callLocalTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'memory_compress_file': {
      const inputPath = requiredString(args, 'path');
      const filePath = resolveSafePath(inputPath);
      const [text, truncated] = await readFileCapped(filePath);
      const outline = text
        .split('\n')
        .filter((line) => /^\s*(export\s|function\s|class\s|#+\s)/.test(line))
        .slice(0, 80)
        .join('\n');
      const body: Record<string, unknown> = {
        content: `文件摘要 ${inputPath}${truncated ? ' (truncated to 200KB)' : ''}\n${outline}`,
        type: 'pattern',
        tags: ['file-summary'],
      };
      const project = optionalString(args, 'project');
      if (project !== undefined) body.project = project;
      return textResult(await api('/api/memories', { method: 'POST', body }));
    }
    case 'memory_claude_bridge_sync': {
      const direction = optionalEnum(args, 'direction', ['from', 'to']);
      if (direction === undefined) throw new JsonRpcError(-32602, 'direction is required');
      const filePath = resolveSafePath(optionalString(args, 'path') ?? './MEMORY.md');
      if (direction === 'from') {
        const [text] = await readFileCapped(filePath);
        const entries = text
          .split('\n')
          .map((line) => {
            const bullet = /^-\s+(.*)$/.exec(line);
            if (bullet) return bullet[1].trim();
            const heading = /^##\s+(.*)$/.exec(line);
            if (heading) return heading[1].trim();
            return null;
          })
          .filter((entry): entry is string => entry !== null && entry.length > 0);
        if (entries.length === 0) throw new JsonRpcError(-32602, 'no importable entries found in the file');
        const body = {
          memories: entries.map((content) => ({ content, tags: ['claude-bridge'] })),
          strategy: 'skip',
        };
        const result = await api('/api/memories/import', { method: 'POST', body });
        return textResult({ direction, path: filePath, entries: entries.length, result });
      }
      const result = (await api('/api/memories?tags=claude-bridge&limit=500')) as Record<string, unknown>;
      const memories = Array.isArray(result.memories) ? (result.memories as Array<Record<string, unknown>>) : [];
      const markdown = ['# Memory', '', ...memories.map((m) => `- ${String(m.content ?? '')}`), ''].join('\n');
      await mkdir(nodePath.dirname(filePath), { recursive: true });
      await writeFile(filePath, markdown, 'utf8');
      return textResult({ direction, path: filePath, written: memories.length });
    }
    case 'memory_obsidian_export': {
      const dir = resolveSafePath(requiredString(args, 'dir'));
      const bundle = (await api('/api/memories/export')) as Record<string, unknown>;
      const memories = Array.isArray(bundle)
        ? (bundle as Array<Record<string, unknown>>)
        : Array.isArray(bundle.memories)
          ? (bundle.memories as Array<Record<string, unknown>>)
          : [];
      await mkdir(dir, { recursive: true });
      let written = 0;
      for (const memory of memories) {
        const id = typeof memory.id === 'string' && UUID_RE.test(memory.id) ? memory.id : randomUUID();
        const tags = Array.isArray(memory.tags) ? (memory.tags as unknown[]).map(String) : [];
        const frontmatter = [
          '---',
          `id: ${id}`,
          `type: ${String(memory.type ?? 'fact')}`,
          `tags: [${tags.map((t) => JSON.stringify(t)).join(', ')}]`,
          `createdAt: ${String(memory.createdAt ?? '')}`,
          '---',
          '',
        ].join('\n');
        await writeFile(nodePath.join(dir, `${id}.md`), `${frontmatter}${String(memory.content ?? '')}\n`, 'utf8');
        written += 1;
      }
      return textResult({ dir, written });
    }
    default:
      throw new JsonRpcError(-32602, `Unknown tool: ${name}`);
  }
}

async function handle(method: string, params: Record<string, unknown>): Promise<unknown> {
  if (method === 'initialize') {
    const protocolVersion = typeof params.protocolVersion === 'string' ? params.protocolVersion : '2024-11-05';
    return {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'agent-recall', version: '0.4.0' },
    };
  }
  if (method === 'notifications/initialized' || method === 'initialized') return {};
  if (method === 'tools/list') {
    const remote = await listRemoteTools();
    const local = profile() === 'full' ? LOCAL_TOOLS : [];
    const seen = new Set(remote.map((tool) => tool.name));
    return { tools: [...remote, ...local.filter((tool) => !seen.has(tool.name))] };
  }
  if (method === 'tools/call') {
    const name = typeof params.name === 'string' ? params.name : '';
    const args =
      typeof params.arguments === 'object' && params.arguments !== null
        ? (params.arguments as Record<string, unknown>)
        : {};
    if (isLocalTool(name)) {
      await api('/api/auth/me');
      if (profile() !== 'full') throw new JsonRpcError(-32602, hiddenMessage(name));
      return callLocalTool(name, args);
    }
    return callRemoteTool(name, args);
  }
  throw new JsonRpcError(-32601, `Method not found: ${method}`);
}

createStdioTransport((method, params) => handle(method, params)).start();
