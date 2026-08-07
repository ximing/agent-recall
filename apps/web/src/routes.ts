export const ROUTES = {
  login: '/login',
  memories: '/memories',
  tokens: '/tokens',
  mcp: '/mcp',
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];

export const PAGE_LIST: ReadonlyArray<{ path: AppRoute; title: string; auth: boolean }> = [
  { path: ROUTES.login, title: '登录', auth: false },
  { path: ROUTES.memories, title: '记忆', auth: true },
  { path: ROUTES.tokens, title: '令牌', auth: true },
  { path: ROUTES.mcp, title: 'MCP', auth: true },
];
