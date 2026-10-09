import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { agentExecutions, type AgentStep, type AgentTurnMeta } from '../db/schema.js';
import { AppError } from '../errors.js';
import type { ChatMessage } from '../llm/client.js';
import { resolveDefaultModel } from '../llm/client.js';
import { completeChat } from '../llm/usage.js';

/**
 * 后续能力走这里，不要各自直连模型。
 * 一次 runAgent 写一行 agent_executions，对话通过 completeChat 记到 llm_usage_logs。
 * steps / turns 只留角色和长度，不留提示词正文。
 */
export interface AgentEnv {
  encryptionKey: string;
  appEnv?: string;
}

export interface AgentRequest {
  userId: string;
  agentType: string;
  messages: ChatMessage[];
  maxTokens?: number;
  timeoutMs?: number;
}

export interface AgentResult {
  executionId: string;
  text: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costEstimate: number;
}

function turnMeta(messages: ChatMessage[]): AgentTurnMeta[] {
  return messages.map((message) => ({ role: message.role, chars: message.content.length }));
}

async function finish(
  db: Database,
  id: string,
  status: 'done' | 'failed',
  error: string | null,
  steps: AgentStep[],
  turns: AgentTurnMeta[],
  resultSummary: string | null,
): Promise<void> {
  try {
    await db
      .update(agentExecutions)
      .set({
        status,
        finishedAt: new Date(),
        error,
        steps,
        turns,
        resultSummary,
      })
      .where(eq(agentExecutions.id, id));
  } catch (err) {
    console.error('agent.finish_failed', err);
  }
}

export async function runAgent(db: Database, env: AgentEnv, request: AgentRequest): Promise<AgentResult> {
  const id = randomUUID();
  const now = new Date();
  await db.insert(agentExecutions).values({
    id,
    userId: request.userId,
    agentType: request.agentType.slice(0, 32),
    status: 'running',
    startedAt: now,
    steps: [],
    turns: turnMeta(request.messages),
    createdAt: now,
  });

  try {
    const resolved = await resolveDefaultModel(db, request.userId, env.encryptionKey, env.appEnv);
    if (!resolved) {
      await finish(db, id, 'failed', '尚未配置大模型', [{ name: 'resolve-model', ok: false }], turnMeta(request.messages), null);
      throw new AppError(409, 'LLM_NOT_CONFIGURED', '尚未配置大模型');
    }
    const result = await completeChat(
      db,
      request.userId,
      {
        messages: request.messages,
        maxTokens: request.maxTokens ?? 1024,
        timeoutMs: request.timeoutMs ?? 60_000,
        temperature: 0,
      },
      { resolved, executionId: id, encryptionKey: env.encryptionKey, appEnv: env.appEnv },
    );
    const turns: AgentTurnMeta[] = [...turnMeta(request.messages), { role: 'assistant', chars: result.text.length }];
    await finish(
      db,
      id,
      'done',
      null,
      [{ name: 'complete', ok: true, note: `${String(result.totalTokens)} tokens` }],
      turns,
      `tokens=${String(result.totalTokens)}`,
    );
    return {
      executionId: id,
      text: result.text,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      totalTokens: result.totalTokens,
      costEstimate: result.costEstimate,
    };
  } catch (err) {
    if (!(err instanceof AppError && err.code === 'LLM_NOT_CONFIGURED')) {
      const message = err instanceof Error ? err.message.slice(0, 500) : '模型调用失败';
      await finish(db, id, 'failed', message, [{ name: 'complete', ok: false }], turnMeta(request.messages), null);
    }
    throw err;
  }
}

export async function noteAgentResult(db: Database, executionId: string, summary: string): Promise<void> {
  try {
    await db.update(agentExecutions).set({ resultSummary: summary.slice(0, 500) }).where(eq(agentExecutions.id, executionId));
  } catch (err) {
    console.error('agent.note_failed', err);
  }
}

export async function failAgentResult(db: Database, executionId: string, error: string): Promise<void> {
  try {
    await db
      .update(agentExecutions)
      .set({ status: 'failed', finishedAt: new Date(), error: error.slice(0, 500) })
      .where(eq(agentExecutions.id, executionId));
  } catch (err) {
    console.error('agent.fail_failed', err);
  }
}
