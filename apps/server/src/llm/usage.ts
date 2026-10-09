import { randomUUID } from 'node:crypto';
import type { LlmCapability, LlmUsageList, LlmUsagePublic } from '@agent-recall/dto';
import { desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { llmUsageLogs } from '../db/schema.js';
import { AppError } from '../errors.js';
import {
  completeResolved,
  resolveDefaultModel,
  type ChatCompletion,
  type CompleteChatInput,
  type ResolvedModel,
} from './client.js';
import { estimateCost, estimateTokens } from './pricing.js';

export interface ModelUsageInput {
  userId: string;
  executionId?: string | null;
  provider: string;
  model: string;
  capability: LlmCapability;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costEstimate: number;
  latencyMs?: number | null;
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

/** 写入失败只打日志，不能盖住原来的模型错误。 */
export async function logLlmUsage(db: Database, entry: ModelUsageInput): Promise<void> {
  try {
    await db.insert(llmUsageLogs).values({
      id: randomUUID(),
      userId: entry.userId,
      executionId: entry.executionId ?? null,
      provider: entry.provider.slice(0, 32),
      model: entry.model.slice(0, 128),
      capability: entry.capability,
      promptTokens: Math.max(0, Math.round(entry.promptTokens)),
      completionTokens: Math.max(0, Math.round(entry.completionTokens)),
      totalTokens: Math.max(0, Math.round(entry.totalTokens)),
      costEstimate: entry.costEstimate,
      latencyMs: entry.latencyMs == null ? null : Math.max(0, Math.round(entry.latencyMs)),
      createdAt: new Date(),
    });
  } catch (err) {
    console.error('llm.usage.log_failed', err);
  }
}

export async function safeRecordUsage(
  record: ((entry: ModelUsageInput) => Promise<void>) | undefined,
  entry: ModelUsageInput,
): Promise<void> {
  if (!record) return;
  try {
    await record(entry);
  } catch (err) {
    console.error('llm.usage.log_failed', err);
  }
}

function toPublic(row: typeof llmUsageLogs.$inferSelect): LlmUsagePublic {
  return {
    id: row.id,
    provider: row.provider,
    model: row.model,
    capability: row.capability as LlmCapability,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    totalTokens: row.totalTokens,
    costEstimate: asNumber(row.costEstimate),
    latencyMs: row.latencyMs,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function completeChat(
  db: Database,
  userId: string,
  input: CompleteChatInput,
  opts: { resolved?: ResolvedModel; executionId?: string | null; encryptionKey?: string; appEnv?: string } = {},
): Promise<ChatCompletion> {
  const resolved =
    opts.resolved ??
    (await resolveDefaultModel(db, userId, opts.encryptionKey ?? '', opts.appEnv));
  if (!resolved) throw new AppError(409, 'LLM_NOT_CONFIGURED', '尚未配置大模型');
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let costEstimate = 0;
  let latencyMs = 0;
  try {
    const result = await completeResolved(resolved, input);
    promptTokens = result.promptTokens;
    completionTokens = result.completionTokens;
    totalTokens = result.totalTokens;
    costEstimate = result.costEstimate;
    latencyMs = result.latencyMs;
    return result;
  } catch (err) {
    promptTokens = estimateTokens(input.messages.map((message) => message.content).join('\n'));
    totalTokens = promptTokens;
    costEstimate = estimateCost({
      provider: resolved.provider,
      model: resolved.model,
      capability: 'chat',
      promptTokens,
      completionTokens: 0,
    });
    throw err instanceof AppError ? err : new AppError(502, 'LLM_UNAVAILABLE', '模型调用失败');
  } finally {
    await logLlmUsage(db, {
      userId,
      executionId: opts.executionId ?? null,
      provider: resolved.provider,
      model: resolved.model,
      capability: 'chat',
      promptTokens,
      completionTokens,
      totalTokens,
      costEstimate,
      latencyMs,
    });
  }
}

export async function listLlmUsage(db: Database, userId: string, limit: number): Promise<LlmUsageList> {
  const rows = await db
    .select()
    .from(llmUsageLogs)
    .where(eq(llmUsageLogs.userId, userId))
    .orderBy(desc(llmUsageLogs.createdAt))
    .limit(limit);
  const [sum] = await db
    .select({
      cost: sql<string>`coalesce(sum(${llmUsageLogs.costEstimate}), 0)`,
      tokens: sql<string>`coalesce(sum(${llmUsageLogs.totalTokens}), 0)`,
    })
    .from(llmUsageLogs)
    .where(eq(llmUsageLogs.userId, userId));
  return {
    logs: rows.map(toPublic),
    totalCost: asNumber(sum?.cost),
    totalTokens: Math.round(asNumber(sum?.tokens)),
  };
}
