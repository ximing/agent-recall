import type { LlmCapability } from '@agent-recall/dto';

/**
 * 估算价，美元 / 百万 token。不是账单。
 * 提供方没回用量时用字符数 / 4 代替 token。
 */

interface TokenRate {
  input: number;
  output: number;
}

const CHAT_RATES: ReadonlyArray<{ match: RegExp; rate: TokenRate }> = [
  { match: /^gpt-4o-mini/i, rate: { input: 0.15, output: 0.6 } },
  { match: /^gpt-4\.1-mini/i, rate: { input: 0.4, output: 1.6 } },
  { match: /^gpt-4\.1/i, rate: { input: 2, output: 8 } },
  { match: /^gpt-4o/i, rate: { input: 2.5, output: 10 } },
  { match: /^o4-mini|^o3-mini/i, rate: { input: 1.1, output: 4.4 } },
  { match: /^deepseek-reasoner/i, rate: { input: 0.55, output: 2.19 } },
  { match: /^deepseek/i, rate: { input: 0.27, output: 1.1 } },
  { match: /^claude-.*haiku/i, rate: { input: 0.8, output: 4 } },
  { match: /^claude-.*opus/i, rate: { input: 15, output: 75 } },
  { match: /^claude/i, rate: { input: 3, output: 15 } },
  { match: /^glm-4-flash|^glm-4\.5-flash/i, rate: { input: 0.01, output: 0.01 } },
  { match: /^glm/i, rate: { input: 0.7, output: 0.7 } },
  { match: /^qwen-turbo/i, rate: { input: 0.05, output: 0.2 } },
  { match: /^qwen-max/i, rate: { input: 1.6, output: 6.4 } },
  { match: /^qwen/i, rate: { input: 0.4, output: 1.2 } },
];

const CHAT_DEFAULT: Record<string, TokenRate> = {
  openai: { input: 0.15, output: 0.6 },
  deepseek: { input: 0.27, output: 1.1 },
  claude: { input: 3, output: 15 },
  zhipu: { input: 0.7, output: 0.7 },
  dashscope: { input: 0.4, output: 1.2 },
};

const EMBED_PER_MILLION = 0.07;
const RERANK_PER_MILLION = 0.1;

export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.max(1, Math.ceil([...text].length / 4));
}

export function readUsageTokens(json: unknown, fallback: number): number {
  const usage = (json as { usage?: { input_tokens?: unknown; prompt_tokens?: unknown; total_tokens?: unknown } }).usage;
  for (const value of [usage?.input_tokens, usage?.prompt_tokens, usage?.total_tokens]) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.round(value);
  }
  return fallback;
}

function chatRate(provider: string, model: string): TokenRate {
  for (const entry of CHAT_RATES) {
    if (entry.match.test(model)) return entry.rate;
  }
  return CHAT_DEFAULT[provider] ?? { input: 0.5, output: 1.5 };
}

function round8(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

export function estimateCost(input: {
  provider: string;
  model: string;
  capability: LlmCapability;
  promptTokens: number;
  completionTokens: number;
}): number {
  const prompt = Math.max(0, input.promptTokens);
  const completion = Math.max(0, input.completionTokens);
  if (input.capability === 'embed') return round8((prompt * EMBED_PER_MILLION) / 1_000_000);
  if (input.capability === 'rerank') return round8((prompt * RERANK_PER_MILLION) / 1_000_000);
  const rate = chatRate(input.provider, input.model);
  return round8((prompt * rate.input + completion * rate.output) / 1_000_000);
}
