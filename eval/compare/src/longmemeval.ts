import { readFileSync } from 'node:fs';

export interface LongMemTurn {
  role: string;
  content: string;
}

export interface LongMemQuestion {
  id: string;
  type: string;
  question: string;
  answer: string;
  goldSessionIds: string[];
  sessions: Array<{ id: string; content: string }>;
  abstention: boolean;
}

interface RawEntry {
  question_id: string;
  question_type: string;
  question: string;
  answer?: string;
  answer_session_ids?: string[];
  haystack_session_ids?: string[];
  haystack_sessions?: LongMemTurn[][];
}

/** benchmark/longmemeval-bench.ts 丢掉的拒答类型。 */
const ABSTENTION_TYPES = new Set([
  'single-session-user_abs',
  'multi-session_abs',
  'knowledge-update_abs',
  'temporal-reasoning_abs',
]);

/** 与 benchmark/longmemeval-bench.ts 的 chunkSessionToText 相同。 */
export function flattenSession(turns: readonly LongMemTurn[]): string {
  return turns.map((turn) => `${turn.role}: ${turn.content}`).join('\n');
}

export function isAbstention(questionType: string, questionId = ''): boolean {
  // cleaned 文件把拒答类型写成了原类型，只在 question_id 上保留 `_abs`。
  return (
    questionType.endsWith('_abs') ||
    questionId.endsWith('_abs') ||
    ABSTENTION_TYPES.has(questionType)
  );
}

export function loadLongMemEval(path: string): LongMemQuestion[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as RawEntry[];
  return raw.map((entry) => {
    const ids = entry.haystack_session_ids ?? [];
    const sessions = entry.haystack_sessions ?? [];
    if (ids.length !== sessions.length) {
      throw new Error(
        `${entry.question_id}: haystack_session_ids (${ids.length}) 与 haystack_sessions (${sessions.length}) 长度不同`,
      );
    }
    return {
      id: entry.question_id,
      type: entry.question_type,
      question: entry.question,
      answer: entry.answer ?? '',
      goldSessionIds: entry.answer_session_ids ?? [],
      sessions: ids.map((id, index) => ({ id, content: flattenSession(sessions[index] ?? []) })),
      abstention: isAbstention(entry.question_type, entry.question_id),
    };
  });
}

/**
 * 与 agentmemory eval/runner/load.ts 的 stratifySample 相同：
 * 题型名排序，题型内部保持原文件顺序，每类取前 perType 题。
 */
export function stratifySample<T extends { type: string }>(questions: readonly T[], perType: number): T[] {
  const buckets = new Map<string, T[]>();
  for (const question of questions) {
    const list = buckets.get(question.type) ?? [];
    list.push(question);
    buckets.set(question.type, list);
  }
  const out: T[] = [];
  for (const type of [...buckets.keys()].sort()) {
    out.push(...(buckets.get(type) ?? []).slice(0, perType));
  }
  return out;
}
