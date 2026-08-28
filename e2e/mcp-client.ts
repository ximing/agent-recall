/**
 * 拉起真正的 apps/mcp stdio 进程，按 JSON-RPC 调工具。
 * 和宿主接 MCP 的方式相同：AGENT_RECALL_URL + AGENT_RECALL_TOKEN。
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mcpRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../apps/mcp');

interface RpcMessage {
  id?: number | string | null;
  result?: {
    protocolVersion?: string;
    serverInfo?: { name?: string };
    tools?: Array<{ name: string; inputSchema?: { required?: string[] } }>;
    content?: Array<{ text?: string }>;
  };
  error?: { code?: number; message?: string };
}

export interface ToolResult {
  text: string;
  json: unknown;
}

interface Waiter {
  id: number;
  timer: NodeJS.Timeout;
  resolve: (message: RpcMessage) => void;
  reject: (error: Error) => void;
}

export class McpClient {
  readonly called = new Set<string>();
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly waiters: Waiter[] = [];
  private buffer = '';
  private stderr = '';
  private seq = 0;
  private closed = false;

  private constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.onStdout(chunk));
    child.stderr.on('data', (chunk: string) => {
      this.stderr += chunk;
      if (this.stderr.length > 4000) this.stderr = this.stderr.slice(-4000);
    });
    child.on('exit', (code) => {
      const error = new Error(`mcp exited (${String(code)})\n${this.stderrTail()}`);
      for (const waiter of this.waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    });
  }

  static start(url: string, token: string, extra: NodeJS.ProcessEnv = {}): McpClient {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: mcpRoot,
      env: { ...process.env, AGENT_RECALL_URL: url, AGENT_RECALL_TOKEN: token, ...extra },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return new McpClient(child);
  }

  async initialize(): Promise<RpcMessage> {
    const initialized = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'agent-recall-e2e', version: '0' },
    });
    this.notify('notifications/initialized');
    return initialized;
  }

  async toolNames(): Promise<string[]> {
    const listed = await this.request('tools/list');
    if (listed.error) throw new Error(listed.error.message ?? 'tools/list failed');
    return (listed.result?.tools ?? []).map((tool) => tool.name);
  }

  async toolRequired(name: string): Promise<string[]> {
    const listed = await this.request('tools/list');
    if (listed.error) throw new Error(listed.error.message ?? 'tools/list failed');
    const tool = listed.result?.tools?.find((item) => item.name === name);
    return tool?.inputSchema?.required ?? [];
  }

  async call(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    this.called.add(name);
    const message = await this.request('tools/call', { name, arguments: args });
    if (message.error) {
      throw new Error(`${name}: ${message.error.message ?? 'error'}\n${this.stderrTail()}`);
    }
    const text = message.result?.content?.[0]?.text ?? '';
    return { text, json: parseToolJson(text) };
  }

  /** 期望工具调用失败，返回 JSON-RPC error message。 */
  async fail(name: string, args: Record<string, unknown> = {}): Promise<string> {
    this.called.add(name);
    const message = await this.request('tools/call', { name, arguments: args });
    if (!message.error) {
      const text = message.result?.content?.[0]?.text ?? '';
      throw new Error(`${name}: expected an error, got ${text.slice(0, 300)}`);
    }
    return message.error.message ?? '';
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.child.kill('SIGTERM');
  }

  private request(method: string, params: Record<string, unknown> = {}): Promise<RpcMessage> {
    const id = ++this.seq;
    const response = new Promise<RpcMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.id === id);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error(`timeout waiting for ${method}\n${this.stderrTail()}`));
      }, 20_000);
      this.waiters.push({ id, timer, resolve, reject });
    });
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return response;
  }

  private notify(method: string): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    let index = this.buffer.indexOf('\n');
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      index = this.buffer.indexOf('\n');
      if (!line) continue;
      let message: RpcMessage;
      try {
        message = JSON.parse(line) as RpcMessage;
      } catch {
        continue;
      }
      const waiter = this.waiters.shift();
      if (!waiter) continue;
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
  }

  private stderrTail(): string {
    return this.stderr.trim().slice(-500);
  }
}

function parseToolJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}
