import type { MemoryType, Origin } from '@agent-recall/dto';

export const ORIGIN_LABEL: Record<Origin, string> = {
  web: '网页',
  agent: '代理',
  hook: '钩子',
  import: '导入',
  summary: '摘要',
};

export const TYPE_LABEL: Record<MemoryType, string> = {
  fact: '事实',
  preference: '偏好',
  pattern: '模式',
  architecture: '架构',
  bug: '问题',
  workflow: '流程',
  lesson: '经验',
};
