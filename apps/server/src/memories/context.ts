import type { HookContextInput, HookContextResult, MemoryPublic } from '@agent-recall/dto';
import { recallForUser, type MemoryDeps } from './service.js';

/** 注入文本的近似 token 换算（1 token ≈ 4 字符） */
const CHARS_PER_TOKEN = 4;

export function formatContext(memories: MemoryPublic[], tokenBudget: number): string {
  const budgetChars = tokenBudget * CHARS_PER_TOKEN;
  const header = '## 相关记忆（agent-recall 自动注入）\n';
  let out = header;
  let used = false;
  for (const [index, memory] of memories.entries()) {
    const meta = [memory.type, memory.project, ...(memory.tags.length > 0 ? [memory.tags.join('/')] : [])]
      .filter(Boolean)
      .join(' · ');
    const line = `${index + 1}. [${meta}] ${memory.content.replace(/\s+/g, ' ').trim()}\n`;
    if (out.length + line.length > budgetChars) break;
    out += line;
    used = true;
  }
  return used ? out : '';
}

/**
 * 插件注入与控制台预览共用：只召回来源为 web / agent / summary / import 的记忆，
 * 按 token 预算裁成可放进 prompt 的文本。
 */
export async function buildInjectedContext(
  deps: MemoryDeps,
  userId: string,
  input: HookContextInput,
): Promise<HookContextResult> {
  const tokenBudget = input.tokenBudget ?? 2000;
  const result = await recallForUser(deps, userId, input.query, 20, {
    filter: {
      origin: ['web', 'agent', 'summary', 'import'],
      ...(input.project ? { project: input.project } : {}),
    },
  });
  return {
    context: formatContext(result.memories, tokenBudget),
    memories: result.memories,
  };
}
