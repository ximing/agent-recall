import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import type { AuditEntryPublic } from '@agent-recall/dto';
import type { Database } from '../db/client.js';
import { auditEntries, type AuditEntryRow } from '../db/schema.js';

/**
 * 审计埋点：失败只记日志不阻塞主链路。
 * 在 deleteMemory / batchForget / autoForget / importMemories / share / snapshot restore / heal 处调用。
 */
export async function recordAudit(
  db: Database,
  userId: string,
  action: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(auditEntries).values({
      id: randomUUID(),
      userId,
      action: action.slice(0, 48),
      detail: detail ?? null,
      createdAt: new Date(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`audit ${action} failed: ${message}`);
  }
}

function toEntry(row: AuditEntryRow): AuditEntryPublic {
  return {
    id: row.id,
    action: row.action,
    detail: row.detail ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listAuditEntries(db: Database, userId: string, limit = 100): Promise<AuditEntryPublic[]> {
  const rows = await db
    .select()
    .from(auditEntries)
    .where(eq(auditEntries.userId, userId))
    .orderBy(desc(auditEntries.createdAt))
    .limit(Math.min(Math.max(limit, 1), 500));
  return rows.map(toEntry);
}
