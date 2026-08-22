import { spawn } from 'node:child_process';
import { createSchemaName, dropSchema } from '../src/db/client.js';
import { bootStandin, launchDatabaseUrl, mcpRoot, readJson, sessionFrom, startServer, stopProcess, waitForHealth } from './support.js';

interface RpcMessage {
  id?: number;
  result?: { tools?: { name: string }[]; content?: { text?: string }[] };
  error?: { message?: string };
}

const port = Number(process.env.MCP_LAUNCH_PORT ?? 8792);
const databaseUrl = launchDatabaseUrl();
const schema = createSchemaName();
const standin = await bootStandin();
const base = `http://127.0.0.1:${String(port)}`;
const server = startServer({ port, databaseUrl, schema, standin });
server.stdout?.on('data', (chunk: Buffer) => process.stdout.write(`[server] ${chunk.toString()}`));
server.stderr?.on('data', (chunk: Buffer) => process.stderr.write(`[server] ${chunk.toString()}`));

function openMcp(token: string) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: mcpRoot,
    env: { ...process.env, AGENT_RECALL_URL: base, AGENT_RECALL_TOKEN: token },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
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
      waiters.shift()?.(JSON.parse(line) as RpcMessage);
    }
  });
  child.stderr.on('data', (chunk: Buffer) => process.stderr.write(`[mcp] ${chunk.toString()}`));
  let seq = 0;
  return {
    child,
    request(method: string, params: Record<string, unknown> = {}) {
      const id = ++seq;
      const pending = new Promise<RpcMessage>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout ${method}`)), 8000);
        waiters.push((message) => {
          clearTimeout(timer);
          resolve(message);
        });
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      return pending;
    },
    notify(method: string) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
    },
  };
}

async function exercise(token: string, phrase: string): Promise<void> {
  const mcp = openMcp(token);
  try {
    await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'launch', version: '0' } });
    mcp.notify('notifications/initialized');
    const tools = await mcp.request('tools/list');
    const names = (tools.result?.tools ?? []).map((tool) => tool.name);
    for (const name of ['memory_save', 'memory_recall', 'memory_smart_search']) {
      if (!names.includes(name)) throw new Error(`missing tool ${name}`);
    }
    const saved = await mcp.request('tools/call', { name: 'memory_save', arguments: { content: phrase } });
    if (!saved.result?.content?.[0]?.text?.includes(phrase)) throw new Error(`save missed ${phrase}`);
    const searched = await mcp.request('tools/call', { name: 'memory_smart_search', arguments: { query: phrase } });
    if (!searched.result?.content?.[0]?.text?.includes(phrase)) throw new Error(`search missed ${phrase}`);
    console.log(`PASS mcp phrase=${phrase}`);
  } finally {
    await stopProcess(mcp.child);
  }
}

try {
  await waitForHealth(base);
  const email = `mcp-launch-${String(Date.now())}@example.com`;
  const registered = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'mcp-launch-password' }),
  });
  const cookie = sessionFrom(registered);
  await readJson(registered);
  async function mint(name: string): Promise<{ secret: string; id: string }> {
    const body = await readJson(
      await fetch(`${base}/api/tokens`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: `ar_session=${cookie}` },
        body: JSON.stringify({ name }),
      }),
    );
    return { secret: String(body.secret), id: (body.token as { id: string }).id };
  }
  const first = await mint('mcp-1');
  const second = await mint('mcp-2');
  await exercise(first.secret, `MCP一号-${String(Date.now())}`);
  await exercise(second.secret, `MCP二号-${String(Date.now())}`);
  await readJson(
    await fetch(`${base}/api/tokens/${second.id}/revoke`, {
      method: 'POST',
      headers: { cookie: `ar_session=${cookie}` },
    }),
  );
  const denied = openMcp(second.secret);
  try {
    await denied.request('initialize', { protocolVersion: '2024-11-05', capabilities: {} });
    denied.notify('notifications/initialized');
    const failed = await denied.request('tools/call', { name: 'memory_recall', arguments: { query: 'MCP二号' } });
    if (failed.error?.message !== 'Unauthorized') throw new Error(`expected auth error, got ${JSON.stringify(failed)}`);
    console.log('PASS revoked token is Unauthorized');
  } finally {
    await stopProcess(denied.child);
  }
} finally {
  try {
    await stopProcess(server);
    await standin.close();
  } finally {
    await dropSchema(databaseUrl, schema);
  }
}
