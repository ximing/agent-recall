import type {
  BatchForgetInput,
  ExportResult,
  ImportInput,
  McpClientPublic,
  MemoryCreateInput,
  MemoryListQuery,
  MemoryPublic,
  MemoryStats,
  MemoryUpdateInput,
  RecallLogPublic,
  SessionSummaryPublic,
  SettingsPublic,
  SettingsUpdateInput,
  TokenPublic,
  UserPublic,
} from '@agent-recall/dto';

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

/** 记忆列表查询参数：数组逗号分隔，空值省略 */
function memoryQueryString(query: MemoryListQuery = {}): string {
  const params = new URLSearchParams();
  if (query.origin?.length) params.set('origin', query.origin.join(','));
  if (query.type?.length) params.set('type', query.type.join(','));
  if (query.tags?.length) params.set('tags', query.tags.join(','));
  if (query.project) params.set('project', query.project);
  if (query.sessionId) params.set('sessionId', query.sessionId);
  if (query.createdAfter) params.set('createdAfter', query.createdAfter);
  if (query.createdBefore) params.set('createdBefore', query.createdBefore);
  if (query.includeExpired) params.set('includeExpired', 'true');
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.offset !== undefined) params.set('offset', String(query.offset));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
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
  listMemories: (query?: MemoryListQuery) =>
    request<{ memories: MemoryPublic[] }>(`/api/memories${memoryQueryString(query)}`),
  recallMemories: (query: string, limit = 50) =>
    request<{ memories: MemoryPublic[] }>('/api/memories/recall', {
      method: 'POST',
      body: JSON.stringify({ query, limit }),
    }),
  createMemory: (input: MemoryCreateInput) =>
    request<{ memory: MemoryPublic }>('/api/memories', { method: 'POST', body: JSON.stringify(input) }),
  updateMemory: (id: string, input: MemoryUpdateInput) =>
    request<{ memory: MemoryPublic }>(`/api/memories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteMemory: (id: string) => request<void>(`/api/memories/${id}`, { method: 'DELETE' }),
  listMemoryVersions: (id: string) => request<{ versions: MemoryPublic[] }>(`/api/memories/${id}/versions`),
  batchForget: (input: BatchForgetInput) =>
    request<{ matched: number; deleted: number }>('/api/memories/batch-forget', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  autoForget: (dryRun?: boolean) =>
    request<{ expired: number; stale: number; deleted: number }>('/api/memories/auto-forget', {
      method: 'POST',
      body: JSON.stringify({ dryRun }),
    }),
  getMemoryStats: () => request<{ stats: MemoryStats }>('/api/memories/stats'),
  exportMemories: () => request<ExportResult>('/api/memories/export'),
  importMemories: (input: ImportInput) =>
    request<{ imported: number; skipped: number; replaced: number }>('/api/memories/import', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  listSessions: () => request<{ sessions: SessionSummaryPublic[] }>('/api/sessions'),
  getSessionMemories: (sessionId: string) =>
    request<{ memories: MemoryPublic[] }>(`/api/sessions/${encodeURIComponent(sessionId)}`),
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
  getSettings: () => request<{ settings: SettingsPublic }>('/api/settings'),
  updateSettings: (input: SettingsUpdateInput) =>
    request<{ settings: SettingsPublic }>('/api/settings', { method: 'PUT', body: JSON.stringify(input) }),
  listRecallLogs: () => request<{ logs: RecallLogPublic[] }>('/api/memories/recall-logs'),
};

export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  return fallback;
}
