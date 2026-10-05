import { and, count, eq, isNull } from 'drizzle-orm';
import type pg from 'pg';
import type { Database } from '../db/client.js';
import { memories } from '../db/schema.js';
import { autoForget } from '../memories/governance.js';
import type { MemoryDeps } from '../memories/service.js';
import type { RetrievalPorts } from '../retrieval/ports.js';
import { reindexPending } from '../retrieval/recall.js';

/** 一小时。定时器只从 index.ts 启动，buildApp 不挂，测试进程不会跟着扫。 */
export const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * 两参数 advisory lock 的第一把钥匙（有符号 int32）。
 * 第二把是 schema 名的哈希，避免测试用的 ar_* schema 和正式库互相挡住。
 */
export const SWEEP_LOCK_CLASS = 0x41525357;

export interface SweepLog {
  info(message: string): void;
  error(error: unknown, message: string): void;
}

export interface SweepDeps {
  db: Database;
  pool: pg.Pool;
  retrieval: RetrievalPorts;
  encryptionKey: string;
  appEnv?: string;
  /** 连接的 search_path。空则按 public 上锁。 */
  schema?: string;
  log?: SweepLog;
}

export interface SweepResult {
  skipped: boolean;
  users: number;
  expired: number;
  stale: number;
  deleted: number;
  reindexed: number;
  failed: number;
}

export function sweepLockKey(schema: string | undefined): number {
  const name = schema?.trim() ? schema.trim() : 'public';
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (Math.imul(hash, 31) + name.charCodeAt(i)) | 0;
  }
  return hash;
}

const emptySkip = (): SweepResult => ({
  skipped: true,
  users: 0,
  expired: 0,
  stale: 0,
  deleted: 0,
  reindexed: 0,
  failed: 0,
});

function report(log: SweepLog | undefined, error: unknown, message: string): void {
  if (log) log.error(error, message);
  else console.error(message, error);
}

async function pendingLatestCount(db: Database, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(memories)
    .where(and(eq(memories.userId, userId), eq(memories.isLatest, true), isNull(memories.indexedAt)));
  return Number(row?.n ?? 0);
}

/**
 * 扫当前 schema 里有记忆的每个用户：删过期行（以及达到 autoForgetDays 的 hook 碎片），并补未建索引的行。
 * 锁是会话级的，必须占住同一条池连接。扫描会打外部索引，不能包进一个事务。
 */
export async function sweepOnce(deps: SweepDeps): Promise<SweepResult> {
  const client = await deps.pool.connect();
  const key = sweepLockKey(deps.schema);
  let locked = false;
  try {
    const result = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1::int4, $2::int4) AS locked',
      [SWEEP_LOCK_CLASS, key],
    );
    locked = result.rows[0]?.locked === true;
    if (!locked) return emptySkip();
    return await sweepUsers(deps);
  } finally {
    await releaseSweepLock(client, locked, key, deps.log);
  }
}

async function releaseSweepLock(
  client: pg.PoolClient,
  locked: boolean,
  key: number,
  log: SweepLog | undefined,
): Promise<void> {
  if (!locked) {
    client.release();
    return;
  }
  try {
    await client.query('SELECT pg_advisory_unlock($1::int4, $2::int4)', [SWEEP_LOCK_CLASS, key]);
    client.release();
  } catch (error) {
    report(log, error, 'maintenance sweep failed to release lock');
    client.release(error instanceof Error ? error : new Error(String(error)));
  }
}

async function sweepUsers(deps: SweepDeps): Promise<SweepResult> {
  const rows = await deps.db.select({ userId: memories.userId }).from(memories).groupBy(memories.userId);
  const totals: SweepResult = {
    skipped: false,
    users: rows.length,
    expired: 0,
    stale: 0,
    deleted: 0,
    reindexed: 0,
    failed: 0,
  };
  const memoryDeps: MemoryDeps = {
    db: deps.db,
    retrieval: deps.retrieval,
    encryptionKey: deps.encryptionKey,
    appEnv: deps.appEnv,
  };
  for (const row of rows) {
    try {
      const forget = await autoForget(memoryDeps, row.userId, false);
      totals.expired += forget.expired;
      totals.stale += forget.stale;
      totals.deleted += forget.deleted;
      const before = await pendingLatestCount(deps.db, row.userId);
      await reindexPending(deps.db, deps.retrieval, row.userId);
      const after = await pendingLatestCount(deps.db, row.userId);
      totals.reindexed += Math.max(before - after, 0);
    } catch (error) {
      totals.failed += 1;
      report(deps.log, error, `maintenance sweep failed for user ${row.userId}`);
    }
  }
  if (totals.deleted > 0 || totals.reindexed > 0 || totals.failed > 0) {
    deps.log?.info(
      `maintenance sweep finished: users=${String(totals.users)} expired=${String(totals.expired)} stale=${String(totals.stale)} deleted=${String(totals.deleted)} reindexed=${String(totals.reindexed)} failed=${String(totals.failed)}`,
    );
  }
  return totals;
}

/** 启动后马上扫一轮，之后按间隔重复。上一轮没结束时跳过，避免同一进程叠两次。 */
export function startMaintenanceSweep(options: {
  run: () => Promise<unknown>;
  intervalMs?: number;
  log: SweepLog;
}): { stop: () => void; idle: () => Promise<void> } {
  let stopped = false;
  let running = false;
  let current: Promise<void> = Promise.resolve();

  const tick = (): void => {
    if (stopped || running) return;
    running = true;
    current = Promise.resolve()
      .then(() => options.run())
      .then(() => undefined)
      .catch((error: unknown) => {
        options.log.error(error, 'maintenance sweep failed');
      })
      .finally(() => {
        running = false;
      });
  };

  const timer = setInterval(tick, options.intervalMs ?? SWEEP_INTERVAL_MS);
  const initial = setTimeout(tick, 0);
  timer.unref();
  initial.unref();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
      clearTimeout(initial);
    },
    idle() {
      return current;
    },
  };
}
