import type {
  AuditEntryPublic,
  BatchForgetInput,
  ConsolidateResult,
  DiagnoseResult,
  ExportResult,
  GraphQueryResult,
  HealResult,
  HookContextInput,
  HookContextResult,
  ImportInput,
  ImportStrategy,
  KvEntryPublic,
  KvPutInput,
  McpClientPublic,
  MemoryCreateInput,
  MemoryListQuery,
  MemoryPublic,
  MemoryStats,
  MemoryUpdateInput,
  MeshSyncInput,
  MeshSyncResult,
  RecallInput,
  RecallLogPublic,
  ReflectInput,
  SessionSummaryPublic,
  SettingsPublic,
  SettingsUpdateInput,
  SnapshotPublic,
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

async function requestRaw(path: string, init: RequestInit = {}): Promise<{ status: number; data: unknown }> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers, credentials: 'include' });
  } catch (err) {
    throw new ApiError(0, 'NETWORK', err instanceof Error ? err.message : '网络错误');
  }
  if (response.status === 204) return { status: 204, data: undefined };
  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  return { status: response.status, data };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { status, data } = await requestRaw(path, init);
  if (status === 204) return undefined as T;
  if (status < 200 || status >= 300) {
    const body = data as ErrorBody;
    throw new ApiError(status, body.error?.code ?? 'ERROR', body.error?.message ?? '请求失败');
  }
  return data as T;
}

function kvPath(namespace: string, key?: string): string {
  const base = `/api/kv/${encodeURIComponent(namespace)}`;
  return key === undefined ? base : `${base}/${encodeURIComponent(key)}`;
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
  recallMemories: (input: RecallInput) =>
    request<{ memories: MemoryPublic[] }>('/api/memories/recall', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  smartSearch: (input: RecallInput) =>
    request<{ memories: MemoryPublic[]; scores: number[]; strategy: string }>('/api/memories/smart-search', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  previewContext: (input: HookContextInput) =>
    request<HookContextResult>('/api/memories/context', { method: 'POST', body: JSON.stringify(input) }),
  shareMemory: (id: string, email: string) =>
    request<{ shared: true }>(`/api/memories/${id}/share`, {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  sharedFeed: () => request<{ memories: MemoryPublic[] }>('/api/memories/shared-feed'),
  memoryRelations: (id: string) => request<{ related: MemoryPublic[] }>(`/api/memories/${id}/relations`),
  consolidate: (dryRun?: boolean) =>
    request<ConsolidateResult>('/api/memories/consolidate', {
      method: 'POST',
      body: JSON.stringify({ dryRun }),
    }),
  reflect: (input: ReflectInput) =>
    request<{ memory: MemoryPublic; deduped: boolean }>('/api/memories/reflect', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  crystallizeSession: (sessionId: string) =>
    request<{ memory: MemoryPublic }>(`/api/sessions/${encodeURIComponent(sessionId)}/crystallize`, {
      method: 'POST',
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
  graphQuery: (q?: string, limit?: number) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (limit !== undefined) params.set('limit', String(limit));
    const qs = params.toString();
    return request<GraphQueryResult>(`/api/graph/query${qs ? `?${qs}` : ''}`);
  },
  listKv: (namespace: string, limit?: number) =>
    request<{ entries: KvEntryPublic[] }>(`${kvPath(namespace)}${limit !== undefined ? `?limit=${String(limit)}` : ''}`),
  getKv: (namespace: string, key: string) => request<{ entry: KvEntryPublic }>(kvPath(namespace, key)),
  putKv: (namespace: string, key: string, input: KvPutInput) =>
    request<{ entry: KvEntryPublic }>(kvPath(namespace, key), { method: 'PUT', body: JSON.stringify(input) }),
  deleteKv: (namespace: string, key: string) => request<void>(kvPath(namespace, key), { method: 'DELETE' }),
  appendKv: (namespace: string, key: string, value: unknown) =>
    request<{ entry: KvEntryPublic }>(`${kvPath(namespace, key)}/append`, {
      method: 'POST',
      body: JSON.stringify({ value }),
    }),
  /** 租约：409 表示已被持有，返回当前条目而不是抛错 */
  acquireLease: async (name: string, holder: string, ttlSeconds: number) => {
    const { status, data } = await requestRaw(kvPath('leases', name), {
      method: 'PUT',
      body: JSON.stringify({ value: { holder }, ttlSeconds, ifAbsent: true }),
    });
    const body = data as { entry?: KvEntryPublic; error?: { code?: string; message?: string } };
    if (status === 409 && body.entry) return { acquired: false as const, entry: body.entry };
    if (status < 200 || status >= 300) {
      throw new ApiError(status, body.error?.code ?? 'ERROR', body.error?.message ?? '获取租约失败');
    }
    if (!body.entry) throw new ApiError(status, 'ERROR', '获取租约失败');
    return { acquired: true as const, entry: body.entry };
  },
  listSnapshots: () => request<{ snapshots: SnapshotPublic[] }>('/api/snapshots'),
  createSnapshot: (note?: string) =>
    request<{ snapshot: SnapshotPublic }>('/api/snapshots', {
      method: 'POST',
      body: JSON.stringify({ note }),
    }),
  restoreSnapshot: (id: string, strategy?: ImportStrategy) =>
    request<{ imported: number; skipped: number; replaced: number }>(`/api/snapshots/${id}/restore`, {
      method: 'POST',
      body: JSON.stringify({ strategy }),
    }),
  meshSync: (input: MeshSyncInput) =>
    request<MeshSyncResult>('/api/mesh/sync', { method: 'POST', body: JSON.stringify(input) }),
  diagnose: () => request<DiagnoseResult>('/api/admin/diagnose'),
  heal: () => request<HealResult>('/api/admin/heal', { method: 'POST' }),
  listAudit: (limit = 100) => request<{ entries: AuditEntryPublic[] }>(`/api/audit?limit=${String(limit)}`),
};

export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  return fallback;
}
