import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { memories } from '../db/schema.js';
import { createRetrieval } from '../retrieval/ports.js';
import { startProtocolStandin, type ProtocolStandIn } from '../retrieval/protocol-standin.js';
import { call, makeDataDir, openTestApp, removeDataDir, schemaFor, sessionCookie, testConfig } from '../test/app-harness.js';
import { SWEEP_INTERVAL_MS, SWEEP_LOCK_CLASS, startMaintenanceSweep, sweepLockKey, sweepOnce, type SweepResult } from './sweep.js';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe('maintenance sweep', () => {
  let dataDir = '';
  let app: FastifyInstance;
  let standin: ProtocolStandIn;
  let tokenA = '';
  let tokenB = '';

  beforeAll(async () => {
    standin = await startProtocolStandin();
    dataDir = await makeDataDir();
    const config = testConfig({
      MEILI_URL: standin.url,
      MEILI_API_KEY: 'meili-test',
      QDRANT_URL: standin.url,
      QDRANT_API_KEY: 'qdrant-test',
      EMBEDDING_API_KEY: 'dash-test',
      EMBEDDING_BASE_URL: standin.url,
      EMBEDDING_DIMENSIONS: 8,
    });
    app = await openTestApp({ dataDir, config, retrieval: createRetrieval(config) });
    tokenA = await register(app, 'sweep-a@example.com');
    tokenB = await register(app, 'sweep-b@example.com');
  });

  afterAll(async () => {
    await app.close();
    await standin.close();
    await removeDataDir(dataDir);
  });

  function runSweep(): Promise<SweepResult> {
    return sweepOnce({
      db: app.ctx.db,
      pool: app.ctx.pool,
      retrieval: app.ctx.retrieval,
      encryptionKey: app.ctx.config.ENCRYPTION_KEY,
      schema: schemaFor(dataDir),
      log: { info() {}, error() {} },
    });
  }

  it('clears expired memories for every user, reindexes pending rows, and keeps fresh hook fragments', async () => {
    await call(app, 'POST', '/api/memories', { token: tokenA, payload: { content: '定时扫描-保留' } });
    await call(app, 'POST', '/api/memories', {
      token: tokenA,
      payload: { content: '定时扫描-过期', expiresAt: new Date(Date.now() - 1000).toISOString() },
    });
    const pending = await call(app, 'POST', '/api/memories', { token: tokenA, payload: { content: '定时扫描-未索引' } });
    const pendingId = (pending.body?.memory as { id: string }).id;
    await app.ctx.db.update(memories).set({ indexedAt: null }).where(eq(memories.id, pendingId));
    const stale = await call(app, 'POST', '/api/memories', { token: tokenA, payload: { content: '定时扫描-钩子碎片' } });
    const staleId = (stale.body?.memory as { id: string }).id;
    await app.ctx.db
      .update(memories)
      .set({
        origin: 'hook',
        accessCount: 0,
        expiresAt: null,
        createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
      })
      .where(eq(memories.id, staleId));
    await call(app, 'POST', '/api/memories', {
      token: tokenB,
      payload: { content: '定时扫描-乙过期', expiresAt: new Date(Date.now() - 1000).toISOString() },
    });

    const dirty = await call(app, 'GET', '/api/admin/diagnose', { token: tokenA });
    const problems = dirty.body?.problems as Array<{ code: string; fix: string }>;
    const codes = problems.map((problem) => problem.code);
    expect(codes).toContain('EXPIRED_MEMORIES');
    expect(codes).toContain('PENDING_INDEX');
    expect(problems.find((problem) => problem.code === 'EXPIRED_MEMORIES')?.fix).toContain('每小时');

    const first = await runSweep();
    expect(first.skipped).toBe(false);
    expect(first.users).toBeGreaterThanOrEqual(2);
    expect(first.deleted).toBeGreaterThanOrEqual(2);
    expect(first.expired).toBeGreaterThanOrEqual(2);
    expect(first.reindexed).toBeGreaterThanOrEqual(1);
    expect(first.failed).toBe(0);

    const kept = await call(app, 'GET', '/api/memories?includeExpired=true', { token: tokenA });
    const keptText = JSON.stringify(kept.body);
    expect(keptText).toContain('定时扫描-保留');
    expect(keptText).toContain('定时扫描-钩子碎片');
    expect(keptText).not.toContain('定时扫描-过期');
    const other = await call(app, 'GET', '/api/memories?includeExpired=true', { token: tokenB });
    expect(JSON.stringify(other.body)).not.toContain('定时扫描-乙过期');

    const [row] = await app.ctx.db
      .select({ indexedAt: memories.indexedAt })
      .from(memories)
      .where(eq(memories.id, pendingId));
    expect(row?.indexedAt).not.toBeNull();

    const after = await call(app, 'GET', '/api/admin/diagnose', { token: tokenA });
    const afterCodes = (after.body?.problems as Array<{ code: string }>).map((problem) => problem.code);
    expect(afterCodes).not.toContain('EXPIRED_MEMORIES');
    expect(afterCodes).not.toContain('PENDING_INDEX');

    const audit = await call(app, 'GET', '/api/audit', { token: tokenA });
    const actions = (audit.body?.entries as Array<{ action: string }>).map((entry) => entry.action);
    expect(actions).toContain('memory.auto_forget');
    expect(actions).not.toContain('admin.heal');

    const second = await runSweep();
    expect(second.skipped).toBe(false);
    expect(second.deleted).toBe(0);
  });

  it('does not delete while another session holds the schema lock', async () => {
    await call(app, 'POST', '/api/memories', {
      token: tokenA,
      payload: { content: '定时扫描-锁', expiresAt: new Date(Date.now() - 1000).toISOString() },
    });
    const client = await app.ctx.pool.connect();
    const key = sweepLockKey(schemaFor(dataDir));
    try {
      const locked = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock($1::int4, $2::int4) AS locked',
        [SWEEP_LOCK_CLASS, key],
      );
      expect(locked.rows[0]?.locked).toBe(true);
      const skipped = await runSweep();
      expect(skipped.skipped).toBe(true);
      expect(skipped.deleted).toBe(0);
      const listed = await call(app, 'GET', '/api/memories?includeExpired=true', { token: tokenA });
      expect(JSON.stringify(listed.body)).toContain('定时扫描-锁');
    } finally {
      await client.query('SELECT pg_advisory_unlock($1::int4, $2::int4)', [SWEEP_LOCK_CLASS, key]);
      client.release();
    }
    const ran = await runSweep();
    expect(ran.skipped).toBe(false);
    expect(ran.deleted).toBeGreaterThanOrEqual(1);
    const after = await call(app, 'GET', '/api/memories?includeExpired=true', { token: tokenA });
    expect(JSON.stringify(after.body)).not.toContain('定时扫描-锁');
  });
});

describe('sweep lock key', () => {
  it('uses public when the schema is blank and keeps each schema on its own key', () => {
    expect(SWEEP_INTERVAL_MS).toBe(60 * 60 * 1000);
    expect(sweepLockKey(undefined)).toBe(sweepLockKey('public'));
    expect(sweepLockKey('')).toBe(sweepLockKey('public'));
    expect(sweepLockKey('ar_a')).not.toBe(sweepLockKey('ar_b'));
    expect(sweepLockKey('ar_example')).toBeGreaterThanOrEqual(-2147483648);
    expect(sweepLockKey('ar_example')).toBeLessThanOrEqual(2147483647);
  });
});

describe('maintenance timer', () => {
  it('runs once immediately, skips overlapping ticks, and stops', async () => {
    let calls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handle = startMaintenanceSweep({
      intervalMs: 20,
      log: { info() {}, error() {} },
      run: () => {
        calls += 1;
        return gate;
      },
    });
    await delay(60);
    expect(calls).toBe(1);
    release();
    await delay(80);
    expect(calls).toBeGreaterThan(1);
    const stoppedAt = calls;
    handle.stop();
    await handle.idle();
    await delay(60);
    expect(calls).toBe(stoppedAt);
  });

  it('logs a failed tick and keeps scheduling', async () => {
    const errors: string[] = [];
    let calls = 0;
    const handle = startMaintenanceSweep({
      intervalMs: 20,
      log: {
        info() {},
        error(_error, message) {
          errors.push(message);
        },
      },
      run: async () => {
        calls += 1;
        if (calls === 1) throw new Error('boom');
      },
    });
    await delay(70);
    handle.stop();
    await handle.idle();
    expect(calls).toBeGreaterThan(1);
    expect(errors.some((message) => message.includes('maintenance sweep failed'))).toBe(true);
  });
});

async function register(app: FastifyInstance, email: string): Promise<string> {
  const registered = await call(app, 'POST', '/api/auth/register', {
    payload: { email, password: 'password-sweep' },
  });
  const cookie = sessionCookie(registered.headers);
  const created = await call(app, 'POST', '/api/tokens', { cookie, payload: { name: 'sweep' } });
  return String(created.body?.secret);
}
