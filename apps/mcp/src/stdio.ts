export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export class JsonRpcError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = 'JsonRpcError';
    this.code = code;
  }
}

export type RequestHandler = (method: string, params: Record<string, unknown>) => Promise<unknown>;

function isNotification(id: unknown): boolean {
  return id === undefined || id === null;
}

export async function processLine(line: string, handler: RequestHandler, writeOut: (response: JsonRpcResponse) => void): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    writeOut({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  const request = parsed as JsonRpcRequest;
  if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    if (typeof request?.id === 'string' || typeof request?.id === 'number') {
      writeOut({ jsonrpc: '2.0', id: request.id, error: { code: -32600, message: 'Invalid Request' } });
    }
    return;
  }
  const notification = isNotification(request.id);
  try {
    const result = await handler(request.method, request.params ?? {});
    if (notification) return;
    writeOut({ jsonrpc: '2.0', id: request.id as string | number, result });
  } catch (err) {
    if (notification) return;
    writeOut({
      jsonrpc: '2.0',
      id: request.id as string | number,
      error: {
        code: err instanceof JsonRpcError ? err.code : -32603,
        message: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

function findHeaderEnd(buffer: Buffer): { headerEnd: number; bodyStart: number } | null {
  const crlf = buffer.indexOf('\r\n\r\n');
  const lf = buffer.indexOf('\n\n');
  if (crlf === -1 && lf === -1) return null;
  if (crlf !== -1 && (lf === -1 || crlf <= lf)) return { headerEnd: crlf, bodyStart: crlf + 4 };
  return { headerEnd: lf, bodyStart: lf + 2 };
}

export function formatResponse(response: JsonRpcResponse, framed: boolean): string | Buffer[] {
  const body = JSON.stringify(response);
  if (!framed) return `${body}\n`;
  const bytes = Buffer.from(body, 'utf8');
  return [Buffer.from(`Content-Length: ${String(bytes.length)}\r\n\r\n`, 'ascii'), bytes];
}

export function createStdioTransport(handler: RequestHandler): { start: () => void } {
  let buffer = Buffer.alloc(0);
  let framed = false;
  let queue = Promise.resolve();

  const writeOut = (response: JsonRpcResponse): void => {
    const formatted = formatResponse(response, framed);
    if (typeof formatted === 'string') {
      process.stdout.write(formatted);
      return;
    }
    for (const chunk of formatted) process.stdout.write(chunk);
  };

  function onMessage(message: string): void {
    queue = queue.then(() => processLine(message, handler, writeOut)).catch((err: unknown) => {
      process.stderr.write(`[agent-recall-mcp] ${err instanceof Error ? err.message : String(err)}\n`);
    });
  }

  function processBuffer(): void {
    while (buffer.length > 0) {
      if (buffer[0] === 10 || buffer[0] === 13) {
        buffer = buffer.subarray(1);
        continue;
      }
      const preview = buffer.toString('ascii', 0, Math.min(buffer.length, 32));
      if (/^content-length:/i.test(preview)) {
        const header = findHeaderEnd(buffer);
        if (!header) return;
        const headerText = buffer.subarray(0, header.headerEnd).toString('ascii');
        const match = /^content-length:\s*(\d+)\s*$/im.exec(headerText);
        if (!match) {
          buffer = buffer.subarray(header.bodyStart);
          continue;
        }
        const length = Number(match[1]);
        const messageEnd = header.bodyStart + length;
        if (buffer.length < messageEnd) return;
        framed = true;
        const message = buffer.subarray(header.bodyStart, messageEnd).toString('utf8');
        buffer = buffer.subarray(messageEnd);
        onMessage(message);
        continue;
      }
      const newline = buffer.indexOf(10);
      if (newline === -1) return;
      const line = buffer.subarray(0, newline).toString('utf8').replace(/\r$/, '');
      buffer = buffer.subarray(newline + 1);
      onMessage(line);
    }
  }

  return {
    start() {
      process.stdin.on('data', (chunk: Buffer | string) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        buffer = Buffer.concat([buffer, bytes]);
        processBuffer();
      });
    },
  };
}
