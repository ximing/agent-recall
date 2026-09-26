/**
 * 端到端测试集。
 *
 * 每条记忆带一个不会出现在其他条目里的标记，召回断言用这个标记做字面匹配。
 * protocol-standin 的词法路是子串匹配，所以标记必须原样出现在 content 里。
 *
 * 这批数据经 HTTP 写入，因为 memory_save 不接收 sessionId。
 * MCP 自己的写入（remember、sketch、import、forget 等）在 runner 里另做。
 */
import { PROJECT, SESSION } from './account.js';

export const MARK = {
  arch: '青金石',
  pref: '松烟墨',
  bug: '朱砂',
  flow: '石绿',
  lesson: '赭石',
  pattern: '藤黄',
  commit: '群青',
  commitSha: 'e2eabc1',
  vision: '胭脂',
  file: 'e2e/fixture.ts',
  bridge: '月白',
  share: '霁青',
  shareSecret: 'sk-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  dedupe: '玄色',
  remember: '绛紫',
  sketch: '茶白',
  lessonDrop: '铅丹',
  forget: '铅白',
  disposable: '烟灰',
  govern: '枯荷',
  dup: '并蒂',
  amber: '琥珀',
  expired: '枯叶',
  bridgeImport: '黛色',
  bridgeHeading: '石青',
  core: '缃色',
  web: '素白',
  crystal: '靛蓝',
  action: '补上 e2e 断言',
} as const;

export interface FixtureMemory {
  key: string;
  type: 'fact' | 'preference' | 'pattern' | 'architecture' | 'bug' | 'workflow' | 'lesson';
  content: string;
  tags: string[];
  project: string;
  sessionId?: string;
}

export const CORPUS: FixtureMemory[] = [
  {
    key: 'arch',
    type: 'architecture',
    content: `E2E架构标记-${MARK.arch} 检索融合使用 RRF k=60`,
    tags: ['e2e', 'arch'],
    project: PROJECT,
    sessionId: SESSION,
  },
  {
    key: 'pref',
    type: 'preference',
    content: `E2E偏好标记-${MARK.pref} 测试框架用 vitest`,
    tags: ['e2e'],
    project: PROJECT,
  },
  {
    key: 'bug',
    type: 'bug',
    content: `E2E缺陷标记-${MARK.bug} 过期记忆不得进入召回`,
    tags: ['e2e'],
    project: PROJECT,
  },
  {
    key: 'flow',
    type: 'workflow',
    content: `E2E流程标记-${MARK.flow} 先写入再召回再治理`,
    tags: ['e2e'],
    project: PROJECT,
    sessionId: SESSION,
  },
  {
    key: 'lesson',
    type: 'lesson',
    content: `E2E教训标记-${MARK.lesson} 不要在生产库跑端到端`,
    tags: ['e2e'],
    project: PROJECT,
  },
  {
    key: 'pattern',
    type: 'pattern',
    content: `E2E模式标记-${MARK.pattern} 编辑记忆会追加版本链`,
    tags: ['e2e'],
    project: PROJECT,
  },
  {
    key: 'commit',
    type: 'fact',
    content: `E2E提交标记-${MARK.commit} commit sha ${MARK.commitSha} 修复召回过滤`,
    tags: ['e2e', 'commit'],
    project: PROJECT,
  },
  {
    key: 'vision',
    type: 'fact',
    content: `E2E视觉标记-${MARK.vision} 截图里有登录按钮`,
    tags: ['e2e', 'vision'],
    project: PROJECT,
  },
  {
    key: 'file',
    type: 'pattern',
    content: `文件摘要 ${MARK.file}\nexport function e2eFixtureMarker`,
    tags: ['e2e', 'file-summary'],
    project: PROJECT,
  },
  {
    key: 'bridge',
    type: 'fact',
    content: `E2E桥接标记-${MARK.bridge} claude memory bridge 条目`,
    tags: ['e2e', 'claude-bridge'],
    project: PROJECT,
  },
  {
    key: 'share',
    type: 'fact',
    content: `E2E共享标记-${MARK.share} api_key = ${MARK.shareSecret} 需要清洗`,
    tags: ['e2e', 'kb'],
    project: PROJECT,
  },
];
