/**
 * 端到端专用身份。
 *
 * 这些账号只在 `pnpm e2e` 的临时库里注册，不写入 ~/.agent-recall。
 * 邮箱和密码固定，是为了让失败日志和用例能对上同一个人，不是为了登录开发库。
 */
export const E2E_ACCOUNT = {
  email: 'e2e@agent-recall.test',
  password: 'e2e-password-recall',
  tokenName: 'e2e-agent',
} as const;

/** 同一个服务上的第二个用户：隔离、分享、feed。 */
export const E2E_PEER = {
  email: 'e2e-peer@agent-recall.test',
  password: 'e2e-password-peer',
  tokenName: 'e2e-peer',
} as const;

/** 另一台临时服务上的用户，只给 mesh 同步当 peer。 */
export const E2E_MESH = {
  email: 'e2e-mesh@agent-recall.test',
  password: 'e2e-password-mesh',
  tokenName: 'e2e-mesh',
} as const;

export const PROJECT = 'e2e-suite';
export const SESSION = 'e2e-session-alpha';
export const CRYSTAL_SESSION = 'e2e-session-crystal';
