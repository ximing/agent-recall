export const ROUTES = {
  home: '/',
  login: '/login',
  board: '/board',
  memories: '/memories',
  sessions: '/sessions',
  state: '/state',
  graph: '/graph',
  ops: '/ops',
  tokens: '/tokens',
  mcp: '/mcp',
  settings: '/settings',
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];

export const PAGE_LIST: ReadonlyArray<{ path: AppRoute; title: string; auth: boolean }> = [
  { path: ROUTES.home, title: '说明', auth: false },
  { path: ROUTES.login, title: '登录', auth: false },
  { path: ROUTES.board, title: '看板', auth: true },
  { path: ROUTES.memories, title: '记忆', auth: true },
  { path: ROUTES.sessions, title: '会话', auth: true },
  { path: ROUTES.state, title: '状态', auth: true },
  { path: ROUTES.graph, title: '关系', auth: true },
  { path: ROUTES.ops, title: '治理', auth: true },
  { path: ROUTES.tokens, title: '令牌', auth: true },
  { path: ROUTES.mcp, title: 'MCP', auth: true },
  { path: ROUTES.settings, title: '设置', auth: true },
];
