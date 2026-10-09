import { LLM_DEFAULT_BASE_URL, type LlmProvider } from '@agent-recall/dto';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { llmConfigs, type LlmConfigRow } from '../db/schema.js';
import { AppError } from '../errors.js';
import { assertPublicHttpUrl, LLM_URL_REJECTED_MESSAGE } from '../retrieval/url-guard.js';
import { decryptSecret } from '../settings/crypto.js';
import { estimateCost, estimateTokens, readUsageTokens } from './pricing.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ResolvedModel {
  provider: LlmProvider;
  model: string;
  baseUrl: string;
  apiKey: string;
}

export interface CompleteChatInput {
  messages: ChatMessage[];
  maxTokens?: number;
  timeoutMs?: number;
  temperature?: number;
}

export interface ChatCompletion {
  text: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costEstimate: number;
  latencyMs: number;
}

export const llmTransport: { fetch: typeof fetch } = {
  fetch: globalThis.fetch.bind(globalThis),
};

export function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, '');
  if (trimmed.endsWith('/chat/completions')) return trimmed;
  return `${trimmed}/chat/completions`;
}

export function anthropicMessagesUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, '');
  if (trimmed.endsWith('/messages')) return trimmed;
  if (trimmed.endsWith('/v1')) return `${trimmed}/messages`;
  return `${trimmed}/v1/messages`;
}

function redact(message: string, apiKey: string): string {
  if (!apiKey) return message;
  return message.split(apiKey).join('***');
}

function providerFailure(status: number, body: string, apiKey: string): AppError {
  const cleaned = redact(body, apiKey).slice(0, 180);
  console.error('llm.provider_failed', status, cleaned);
  return new AppError(502, 'LLM_UNAVAILABLE', `模型调用失败 (${String(status)})`);
}

async function readBody(res: Response): Promise<{ json: unknown; text: string }> {
  const text = await res.text();
  if (!text) return { json: null, text: '' };
  try {
    return { json: JSON.parse(text) as unknown, text };
  } catch {
    return { json: null, text };
  }
}

function textFromOpenAI(json: unknown): string {
  const choice = (json as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
  if (typeof choice === 'string') return choice;
  if (Array.isArray(choice)) {
    return choice
      .map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part === 'object' && part !== null && 'text' in part && typeof part.text === 'string') return part.text;
        return '';
      })
      .join('');
  }
  return '';
}

function textFromAnthropic(json: unknown): string {
  const blocks = (json as { content?: Array<{ type?: unknown; text?: unknown }> }).content;
  if (!Array.isArray(blocks)) return '';
  return blocks
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('');
}

export async function resolveDefaultModel(
  db: Database,
  userId: string,
  encryptionKey: string,
  appEnv: string | undefined,
): Promise<ResolvedModel | null> {
  const [row] = await db
    .select()
    .from(llmConfigs)
    .where(and(eq(llmConfigs.userId, userId), eq(llmConfigs.isDefault, true)))
    .limit(1);
  if (!row) return null;
  return resolveRow(row, encryptionKey, appEnv);
}

export async function resolveRow(
  row: LlmConfigRow,
  encryptionKey: string,
  appEnv: string | undefined,
): Promise<ResolvedModel> {
  const provider = row.provider as LlmProvider;
  let apiKey = '';
  try {
    apiKey = decryptSecret(encryptionKey, row.apiKeyEncrypted);
  } catch {
    throw new AppError(400, 'LLM_KEY', '密钥无法解密');
  }
  if (!apiKey) throw new AppError(400, 'LLM_KEY', '密钥无法解密');
  const baseUrl = row.baseUrl?.trim() || LLM_DEFAULT_BASE_URL[provider];
  await assertPublicHttpUrl(baseUrl, { appEnv, message: LLM_URL_REJECTED_MESSAGE });
  return { provider, model: row.model, baseUrl, apiKey };
}

export async function completeResolved(
  resolved: ResolvedModel,
  input: CompleteChatInput,
  fetchImpl: typeof fetch = llmTransport.fetch,
): Promise<ChatCompletion> {
  const started = Date.now();
  const maxTokens = input.maxTokens ?? 1024;
  const timeoutMs = input.timeoutMs ?? 60_000;
  try {
    if (resolved.provider === 'claude') return await completeAnthropic(resolved, input, maxTokens, timeoutMs, fetchImpl, started);
    return await completeOpenAI(resolved, input, maxTokens, timeoutMs, fetchImpl, started);
  } catch (err) {
    if (err instanceof AppError) throw err;
    const aborted = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    console.error('llm.provider_failed', aborted ? 'timeout' : err instanceof Error ? err.name : 'error');
    throw new AppError(502, 'LLM_UNAVAILABLE', aborted ? '模型调用超时' : '模型调用失败');
  }
}

async function completeOpenAI(
  resolved: ResolvedModel,
  input: CompleteChatInput,
  maxTokens: number,
  timeoutMs: number,
  fetchImpl: typeof fetch,
  started: number,
): Promise<ChatCompletion> {
  const res = await fetchImpl(chatCompletionsUrl(resolved.baseUrl), {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${resolved.apiKey}`,
    },
    body: JSON.stringify({
      model: resolved.model,
      messages: input.messages,
      max_tokens: maxTokens,
      temperature: input.temperature ?? 0,
    }),
  });
  const body = await readBody(res);
  if (res.status < 200 || res.status >= 300) throw providerFailure(res.status, body.text, resolved.apiKey);
  const text = textFromOpenAI(body.json);
  const promptTokens = readUsageTokens(body.json, estimateTokens(input.messages.map((message) => message.content).join('\n')));
  const completionTokens = readCompletionTokens(body.json, estimateTokens(text));
  const totalTokens = readTotal(body.json, promptTokens + completionTokens);
  return priced(resolved, text, promptTokens, completionTokens, totalTokens, started);
}

async function completeAnthropic(
  resolved: ResolvedModel,
  input: CompleteChatInput,
  maxTokens: number,
  timeoutMs: number,
  fetchImpl: typeof fetch,
  started: number,
): Promise<ChatCompletion> {
  const system = input.messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');
  const messages = input.messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({ role: message.role, content: message.content }));
  const res = await fetchImpl(anthropicMessagesUrl(resolved.baseUrl), {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'content-type': 'application/json',
      'x-api-key': resolved.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: resolved.model,
      max_tokens: maxTokens,
      temperature: input.temperature ?? 0,
      ...(system ? { system } : {}),
      messages,
    }),
  });
  const body = await readBody(res);
  if (res.status < 200 || res.status >= 300) throw providerFailure(res.status, body.text, resolved.apiKey);
  const text = textFromAnthropic(body.json);
  const usage = (body.json as { usage?: { input_tokens?: unknown; output_tokens?: unknown } }).usage;
  const promptTokens =
    typeof usage?.input_tokens === 'number' ? Math.round(usage.input_tokens) : estimateTokens(input.messages.map((m) => m.content).join('\n'));
  const completionTokens = typeof usage?.output_tokens === 'number' ? Math.round(usage.output_tokens) : estimateTokens(text);
  return priced(resolved, text, promptTokens, completionTokens, promptTokens + completionTokens, started);
}

function readCompletionTokens(json: unknown, fallback: number): number {
  const value = (json as { usage?: { completion_tokens?: unknown; output_tokens?: unknown } }).usage;
  if (typeof value?.completion_tokens === 'number' && value.completion_tokens >= 0) return Math.round(value.completion_tokens);
  if (typeof value?.output_tokens === 'number' && value.output_tokens >= 0) return Math.round(value.output_tokens);
  return fallback;
}

function readTotal(json: unknown, fallback: number): number {
  const value = (json as { usage?: { total_tokens?: unknown } }).usage?.total_tokens;
  if (typeof value === 'number' && value >= 0) return Math.round(value);
  return fallback;
}

function priced(
  resolved: ResolvedModel,
  text: string,
  promptTokens: number,
  completionTokens: number,
  totalTokens: number,
  started: number,
): ChatCompletion {
  return {
    text,
    promptTokens,
    completionTokens,
    totalTokens,
    costEstimate: estimateCost({
      provider: resolved.provider,
      model: resolved.model,
      capability: 'chat',
      promptTokens,
      completionTokens,
    }),
    latencyMs: Date.now() - started,
  };
}
