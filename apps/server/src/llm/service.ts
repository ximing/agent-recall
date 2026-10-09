import { randomUUID } from 'node:crypto';
import type { CreateLlmConfigInput, LlmConfigPublic, LlmTestResult, UpdateLlmConfigInput } from '@agent-recall/dto';
import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { isUniqueViolation } from '../db/errors.js';
import { llmConfigs, type LlmConfigRow } from '../db/schema.js';
import { AppError } from '../errors.js';
import { assertPublicHttpUrl, LLM_URL_REJECTED_MESSAGE } from '../retrieval/url-guard.js';
import { decryptSecret, encryptSecret } from '../settings/crypto.js';
import { resolveRow } from './client.js';
import { completeChat } from './usage.js';

function maskApiKey(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 6) return '******';
  return `${trimmed.slice(0, 6)}…`;
}

function toPublic(row: LlmConfigRow, encryptionKey: string): LlmConfigPublic {
  let preview = '******';
  try {
    const plain = decryptSecret(encryptionKey, row.apiKeyEncrypted);
    if (plain) preview = maskApiKey(plain);
  } catch {
    preview = '******';
  }
  return {
    id: row.id,
    provider: row.provider as LlmConfigPublic['provider'],
    model: row.model,
    isDefault: row.isDefault,
    baseUrl: row.baseUrl,
    apiKeyPreview: preview,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function getOwned(db: Database, userId: string, id: string): Promise<LlmConfigRow> {
  const [row] = await db
    .select()
    .from(llmConfigs)
    .where(and(eq(llmConfigs.id, id), eq(llmConfigs.userId, userId)))
    .limit(1);
  if (!row) throw new AppError(404, 'LLM_PROVIDER_NOT_FOUND', '模型配置不存在');
  return row;
}

async function assertBase(baseUrl: string | null | undefined, appEnv: string | undefined): Promise<void> {
  if (!baseUrl) return;
  await assertPublicHttpUrl(baseUrl, { appEnv, message: LLM_URL_REJECTED_MESSAGE });
}

export async function listLlmConfigs(db: Database, userId: string, encryptionKey: string): Promise<LlmConfigPublic[]> {
  const rows = await db
    .select()
    .from(llmConfigs)
    .where(eq(llmConfigs.userId, userId))
    .orderBy(desc(llmConfigs.createdAt));
  return rows.map((row) => toPublic(row, encryptionKey));
}

export async function createLlmConfig(
  db: Database,
  userId: string,
  input: CreateLlmConfigInput,
  encryptionKey: string,
  appEnv: string | undefined,
): Promise<LlmConfigPublic> {
  await assertBase(input.baseUrl, appEnv);
  const existing = await db
    .select({ id: llmConfigs.id })
    .from(llmConfigs)
    .where(eq(llmConfigs.userId, userId));
  const isDefault = input.isDefault ?? existing.length === 0;
  const now = new Date();
  try {
    const row = await db.transaction(async (tx) => {
      if (isDefault) {
        await tx
          .update(llmConfigs)
          .set({ isDefault: false, updatedAt: now })
          .where(and(eq(llmConfigs.userId, userId), eq(llmConfigs.isDefault, true)));
      }
      const [created] = await tx
        .insert(llmConfigs)
        .values({
          id: randomUUID(),
          userId,
          provider: input.provider,
          apiKeyEncrypted: encryptSecret(encryptionKey, input.apiKey),
          model: input.model,
          isDefault,
          baseUrl: input.baseUrl ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!created) throw new AppError(500, 'INTERNAL', '保存模型配置失败');
      return created;
    });
    return toPublic(row, encryptionKey);
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(409, 'LLM_DEFAULT', '默认模型冲突，请重试');
    throw err;
  }
}

export async function updateLlmConfig(
  db: Database,
  userId: string,
  id: string,
  input: UpdateLlmConfigInput,
  encryptionKey: string,
  appEnv: string | undefined,
): Promise<LlmConfigPublic> {
  const current = await getOwned(db, userId, id);
  if (input.baseUrl !== undefined) await assertBase(input.baseUrl, appEnv);
  const [row] = await db
    .update(llmConfigs)
    .set({
      ...(input.apiKey !== undefined ? { apiKeyEncrypted: encryptSecret(encryptionKey, input.apiKey) } : {}),
      ...(input.model !== undefined ? { model: input.model } : {}),
      ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(llmConfigs.id, current.id), eq(llmConfigs.userId, userId)))
    .returning();
  if (!row) throw new AppError(404, 'LLM_PROVIDER_NOT_FOUND', '模型配置不存在');
  return toPublic(row, encryptionKey);
}

export async function deleteLlmConfig(db: Database, userId: string, id: string): Promise<void> {
  const current = await getOwned(db, userId, id);
  await db.delete(llmConfigs).where(and(eq(llmConfigs.id, current.id), eq(llmConfigs.userId, userId)));
}

export async function setDefaultLlmConfig(
  db: Database,
  userId: string,
  id: string,
  encryptionKey: string,
): Promise<LlmConfigPublic> {
  const current = await getOwned(db, userId, id);
  const now = new Date();
  const row = await db.transaction(async (tx) => {
    await tx
      .update(llmConfigs)
      .set({ isDefault: false, updatedAt: now })
      .where(and(eq(llmConfigs.userId, userId), eq(llmConfigs.isDefault, true)));
    const [updated] = await tx
      .update(llmConfigs)
      .set({ isDefault: true, updatedAt: now })
      .where(and(eq(llmConfigs.id, current.id), eq(llmConfigs.userId, userId)))
      .returning();
    if (!updated) throw new AppError(404, 'LLM_PROVIDER_NOT_FOUND', '模型配置不存在');
    return updated;
  });
  return toPublic(row, encryptionKey);
}

function redactKey(message: string, apiKey: string): string {
  if (!apiKey) return message;
  return message.split(apiKey).join('***');
}

export async function testLlmConfig(
  db: Database,
  userId: string,
  id: string,
  encryptionKey: string,
  appEnv: string | undefined,
): Promise<LlmTestResult> {
  const row = await getOwned(db, userId, id);
  let apiKey = '';
  try {
    const resolved = await resolveRow(row, encryptionKey, appEnv);
    apiKey = resolved.apiKey;
    await completeChat(
      db,
      userId,
      { messages: [{ role: 'user', content: 'Reply with only: pong' }], timeoutMs: 30_000, maxTokens: 64 },
      { resolved, encryptionKey, appEnv },
    );
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : '模型调用失败';
    return { ok: false, error: redactKey(message, apiKey) };
  }
}
