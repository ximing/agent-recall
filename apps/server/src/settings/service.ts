import type { SettingsPublic, SettingsUpdateInput } from '@agent-recall/dto';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { userSettings, type UserSettingsRow } from '../db/schema.js';
import { decryptSecret, encryptSecret, isEncrypted } from './crypto.js';

export async function getSettings(db: Database, userId: string): Promise<UserSettingsRow> {
  const rows = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
  const existing = rows[0];
  if (existing) return existing;
  const inserted = await db.insert(userSettings).values({ userId, updatedAt: new Date() }).returning();
  const row = inserted[0];
  if (!row) throw new Error('初始化设置失败');
  return row;
}

export async function updateSettings(
  db: Database,
  userId: string,
  input: SettingsUpdateInput,
  dataDir: string,
): Promise<UserSettingsRow> {
  await getSettings(db, userId);
  const patch: Partial<
    Pick<UserSettingsRow, 'rerankEnabled' | 'rerankBaseUrl' | 'rerankModel' | 'rerankApiKey' | 'autoForgetDays'>
  > & { updatedAt: Date } = { rerankEnabled: input.rerankEnabled, updatedAt: new Date() };
  if (input.rerankBaseUrl !== undefined) patch.rerankBaseUrl = input.rerankBaseUrl;
  if (input.rerankModel !== undefined) patch.rerankModel = input.rerankModel;
  if (input.rerankApiKey !== undefined) {
    // 空串 = 清除；其余一律加密落库
    patch.rerankApiKey = input.rerankApiKey === '' ? null : encryptSecret(dataDir, input.rerankApiKey);
  }
  if (input.autoForgetDays !== undefined) patch.autoForgetDays = input.autoForgetDays;
  await db.update(userSettings).set(patch).where(eq(userSettings.userId, userId));
  return getSettings(db, userId);
}

/** 读取解密后的 rerankApiKey（不存在时返回 null）。历史明文自动兼容。 */
export function getRerankApiKey(row: UserSettingsRow, dataDir: string): string | null {
  if (!row.rerankApiKey) return null;
  return isEncrypted(row.rerankApiKey) ? decryptSecret(dataDir, row.rerankApiKey) : row.rerankApiKey;
}

export function toSettings(row: UserSettingsRow, dataDir: string): SettingsPublic {
  const key = getRerankApiKey(row, dataDir);
  return {
    rerankEnabled: row.rerankEnabled,
    rerankBaseUrl: row.rerankBaseUrl,
    rerankModel: row.rerankModel,
    hasRerankApiKey: key !== null && key.length > 0,
    rerankApiKeyPreview: key ? `${key.slice(0, 6)}…` : null,
    autoForgetDays: row.autoForgetDays,
  };
}
