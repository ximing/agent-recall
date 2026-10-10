export const TRACK_CODING = 'coding-v1';
export const EQUAL_BUDGET_TOKENS = 2000;
export const JUDGE_PROMPT_VERSION = 'judge-v1';
export const ANSWER_PROMPT_VERSION = 'answer-v1';

export type QueryType =
  | 'exact'
  | 'paraphrase'
  | 'preference'
  | 'temporal'
  | 'update'
  | 'multi'
  | 'abstain';

export type MemoryType = 'fact' | 'preference' | 'pattern' | 'architecture' | 'bug' | 'workflow' | 'lesson';

export interface CorpusMemory {
  id: string;
  type: MemoryType;
  content: string;
  at: string;
  sessionId: string;
  tags?: string[];
}

export interface CorpusQuery {
  id: string;
  type: QueryType;
  query: string;
  relevant: string[];
  /** 必须出现在对应金标记忆里、且不能出现在其他记忆里的短语。 */
  snippets: string[];
  goldAnswer: string;
}

export interface Corpus {
  id: string;
  project: string;
  description: string;
  memories: CorpusMemory[];
  queries: CorpusQuery[];
}

export type JudgeLabel = 'correct' | 'partial' | 'wrong';

export interface QueryRow {
  system: string;
  mode: string;
  queryId: string;
  queryType: QueryType;
  searchLatencyMs: number | null;
  contextLatencyMs: number | null;
  rankedIds: string[];
  shippedTokens: number;
  equalTokens: number;
  /** 裁到等预算后的上下文。全文基线的未裁剪文本不重复存放。 */
  equalContext: string;
  recallAt5: number | null;
  recallAt10: number | null;
  mrr: number | null;
  equalGoldCoverage: number | null;
  falseInjection: boolean | null;
  answer: string | null;
  judge: JudgeLabel | null;
  judgeRaw: string | null;
}

export interface SystemMeta {
  system: string;
  mode: string;
  version: string | null;
  skipped: string | null;
  writeMs: number | null;
  writeEmbedTokens: number | null;
  queryEmbedTokens: number | null;
  notes: string[];
}

export interface HookProbe {
  samples: number;
  latenciesMs: number[];
  p50Ms: number | null;
  p95Ms: number | null;
  stdoutTokens: number[];
  failures: number;
}
