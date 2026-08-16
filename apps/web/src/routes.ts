export const ROUTES = {
  login: '/login',
  memories: '/memories',
  sessions: '/sessions',
  tokens: '/tokens',
  mcp: '/mcp',
  settings: '/settings',
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];

export const PAGE_LIST: ReadonlyArray<{ path: AppRoute; title: string; auth: boolean }> = [
  { path: ROUTES.login, title: '登录', auth: false },
  { path: ROUTES.memories, title: '记忆', auth: true },
  { path: ROUTES.sessions, title: '会话', auth: true },
  { path: ROUTES.tokens, title: '令牌', auth: true },
  { path: ROUTES.mcp, title: 'MCP', auth: true },
  { path: ROUTES.settings, title: '设置', auth: true },
];
