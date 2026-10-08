import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { userFromAccessToken } from '../auth/service.js';
import { readBearerToken } from '../auth/token-logic.js';
import { callServerTool, listServerTools, McpCallError, parseProfile, type ToolProfile } from './bridge.js';

const SUPPORTED_PROTOCOLS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'] as const;
const LATEST_PROTOCOL = SUPPORTED_PROTOCOLS[SUPPORTED_PROTOCOLS.length - 1] ?? '2025-11-25';
const SERVER_INFO = { name: 'agent-recall', version: '0.1.0' };

interface RpcBody {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rpcError(id: unknown, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function rpcResult(id: unknown, result: unknown): Record<string, unknown> {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function profileOf(req: FastifyRequest): ToolProfile {
  const query = (req.query as { profile?: string }).profile;
  const header = req.headers['x-agent-recall-profile'];
  const raw = query ?? (Array.isArray(header) ? header[0] : header);
  return parseProfile(raw);
}

function negotiate(params: unknown): string {
  const requested = isRecord(params) ? params.protocolVersion : undefined;
  return typeof requested === 'string' && (SUPPORTED_PROTOCOLS as readonly string[]).includes(requested)
    ? requested
    : LATEST_PROTOCOL;
}

function wantsJson(accept: string | undefined): boolean {
  if (!accept) return true;
  return accept.includes('application/json') || accept.includes('*/*');
}

function sendRpc(reply: FastifyReply, accept: string | undefined, status: number, payload: unknown) {
  const header = accept ?? '';
  const jsonOk = wantsJson(header);
  const sseOnly = !jsonOk && header.includes('text/event-stream');
  if (sseOnly && status === 200) {
    return reply
      .code(200)
      .header('content-type', 'text/event-stream; charset=utf-8')
      .send(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
  }
  if (!jsonOk && !sseOnly) {
    return reply.code(406).header('content-type', 'application/json; charset=utf-8').send(rpcError(null, -32000, 'Not Acceptable'));
  }
  return reply.code(status).header('content-type', 'application/json; charset=utf-8').send(payload);
}

function methodNotAllowed(reply: FastifyReply) {
  return reply
    .code(405)
    .header('allow', 'POST')
    .header('content-type', 'application/json; charset=utf-8')
    .send(rpcError(null, -32601, 'Method not allowed'));
}

export function registerRemoteMcp(app: FastifyInstance): void {
  app.get('/mcp', async (_req, reply) => methodNotAllowed(reply));
  app.delete('/mcp', async (_req, reply) => methodNotAllowed(reply));

  app.post('/mcp', async (req, reply) => {
    const accept = typeof req.headers.accept === 'string' ? req.headers.accept : undefined;
    const contentType = typeof req.headers['content-type'] === 'string' ? req.headers['content-type'] : '';
    if (!contentType.includes('application/json')) {
      return sendRpc(reply, accept, 415, rpcError(null, -32600, 'Content-Type must be application/json'));
    }
    if (Array.isArray(req.body)) {
      return sendRpc(reply, accept, 400, rpcError(null, -32600, 'JSON-RPC batches are not supported'));
    }
    if (!isRecord(req.body)) {
      return sendRpc(reply, accept, 400, rpcError(null, -32600, 'Invalid Request'));
    }
    const body = req.body as RpcBody;
    const hasId = Object.prototype.hasOwnProperty.call(body, 'id');
    if (body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
      if (!hasId) return reply.code(202).send();
      return sendRpc(reply, accept, 400, rpcError(body.id, -32600, 'Invalid Request'));
    }
    if (!hasId) return reply.code(202).send();

    const bearer = readBearerToken(req.headers.authorization);
    if (!bearer) return sendRpc(reply, accept, 401, rpcError(body.id, -32001, 'Unauthorized'));
    const token = await userFromAccessToken(app.ctx.db, bearer);
    if (!token) return sendRpc(reply, accept, 401, rpcError(body.id, -32001, 'Unauthorized'));

    const profile = profileOf(req);
    const authorization = req.headers.authorization ?? '';
    try {
      if (body.method === 'initialize') {
        return sendRpc(
          reply,
          accept,
          200,
          rpcResult(body.id, {
            protocolVersion: negotiate(body.params),
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER_INFO,
          }),
        );
      }
      if (body.method === 'ping') return sendRpc(reply, accept, 200, rpcResult(body.id, {}));
      if (body.method === 'tools/list') {
        return sendRpc(reply, accept, 200, rpcResult(body.id, { tools: listServerTools(profile) }));
      }
      if (body.method === 'tools/call') {
        const params = isRecord(body.params) ? body.params : {};
        const name = typeof params.name === 'string' ? params.name : '';
        const args = isRecord(params.arguments) ? params.arguments : {};
        if (!name) return sendRpc(reply, accept, 200, rpcResult(body.id, toolError('Tool name is required')));
        try {
          const result = await callServerTool(app, authorization, profile, name, args);
          return sendRpc(reply, accept, 200, rpcResult(body.id, result));
        } catch (err) {
          if (err instanceof McpCallError) return sendRpc(reply, accept, 200, rpcResult(body.id, toolError(err.message)));
          return sendRpc(reply, accept, 200, rpcResult(body.id, toolError('工具调用失败')));
        }
      }
      return sendRpc(reply, accept, 200, rpcError(body.id, -32601, `Method not found: ${body.method}`));
    } catch (err) {
      req.log.error(err);
      return sendRpc(reply, accept, 500, rpcError(body.id, -32603, 'Internal error'));
    }
  });
}

function toolError(message: string): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true };
}
