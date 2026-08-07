import type { McpClientPublic, MemoryPublic, TokenPublic, UserPublic } from '@agent-recall/dto';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

type ErrorBody = { error?: { code?: string; message?: string } };

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers, credentials: 'include' });
  } catch (err) {
    throw new ApiError(0, 'NETWORK', err instanceof Error ? err.message : '网络错误');
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  if (!response.ok) {
    const body = data as ErrorBody;
    throw new ApiError(response.status, body.error?.code ?? 'ERROR', body.error?.message ?? '请求失败');
  }
  return data as T;
}

export const api = {
  register: (email: string, password: string) =>
    request<{ user: UserPublic }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  login: (email: string, password: string) =>
    request<{ user: UserPublic }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
  me: () => request<{ user: UserPublic }>('/api/auth/me'),
  listMemories: () => request<{ memories: MemoryPublic[] }>('/api/memories'),
  createMemory: (content: string) =>
    request<{ memory: MemoryPublic }>('/api/memories', { method: 'POST', body: JSON.stringify({ content }) }),
  updateMemory: (id: string, content: string) =>
    request<{ memory: MemoryPublic }>(`/api/memories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    }),
  deleteMemory: (id: string) => request<void>(`/api/memories/${id}`, { method: 'DELETE' }),
  listTokens: () => request<{ tokens: TokenPublic[] }>('/api/tokens'),
  createToken: (name: string) =>
    request<{ token: TokenPublic; secret: string }>('/api/tokens', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  revokeToken: (id: string) => request<{ token: TokenPublic }>(`/api/tokens/${id}/revoke`, { method: 'POST' }),
  listMcpClients: () => request<{ clients: McpClientPublic[] }>('/api/mcp/clients'),
  createMcpClient: (name: string) =>
    request<{ client: McpClientPublic; secret: string; baseUrl: string; config: string }>('/api/mcp/clients', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  revokeMcpClient: (id: string) =>
    request<{ client: McpClientPublic }>(`/api/mcp/clients/${id}/revoke`, { method: 'POST' }),
};

export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  return fallback;
}
