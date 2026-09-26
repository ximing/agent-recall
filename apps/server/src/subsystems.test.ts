import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRetrieval } from './retrieval/ports.js';
import { startProtocolStandin, type ProtocolStandIn } from './retrieval/protocol-standin.js';
import { call, makeDataDir, openTestApp, removeDataDir, sessionCookie, testConfig } from './test/app-harness.js';

async function registerUserWithToken(app: FastifyInstance, email: string): Promise<{ cookie: string; token: string }> {
  const registered = await call(app, 'POST', '/api/auth/register', {
    payload: { email, password: 'password-subsys' },
  });
  const cookie = sessionCookie(registered.headers);
  const created = await call(app, 'POST', '/api/tokens', { cookie, payload: { name: 'agents' } });
  return { cookie, token: String(created.body?.secret) };
}

describe('subsystems: kv, graph, snapshots, share, crystallize, admin, consolidate, reflect, audit', () => {
  let dataDir = '';
  let app: FastifyInstance;
  let standin: ProtocolStandIn;
  let cookie = '';
  let token = '';
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
    const a = await registerUserWithToken(app, 'sub-a@example.com');
    cookie = a.cookie;
    token = a.token;
    const b = await registerUserWithToken(app, 'sub-b@example.com');
    tokenB = b.token;
  });

  afterAll(async () => {
    await app.close();
    await standin.close();
    await removeDataDir(dataDir);
  });

  it('kv: CRUD, list, append, lease 409, ttl expiry, namespace validation', async () => {
    const put = await call(app, 'PUT', '/api/kv/slots/current_task', {
      token,
      payload: { value: { task: 'refactor' } },
    });
    expect(put.status).toBe(200);
    expect((put.body?.entry as { value: { task: string } }).value.task).toBe('refactor');

    const got = await call(app, 'GET', '/api/kv/slots/current_task', { token });
    expect(got.status).toBe(200);

    // 覆盖写
    const overwritten = await call(app, 'PUT', '/api/kv/slots/current_task', {
      token,
      payload: { value: { task: 'review' } },
    });
    expect((overwritten.body?.entry as { value: { task: string } }).value.task).toBe('review');

    // lease：ifAbsent 且已持有 → 409
    const lease = await call(app, 'PUT', '/api/kv/slots/current_task', {
      token,
      payload: { value: { task: 'steal' }, ifAbsent: true },
    });
    expect(lease.status).toBe(409);
    expect(lease.body?.held).toBe(true);

    // append：新建数组再追加
    const a1 = await call(app, 'POST', '/api/kv/signals/deploy_log/append', { token, payload: { value: 'v1' } });
    expect((a1.body?.entry as { value: unknown[] }).value).toEqual(['v1']);
    const a2 = await call(app, 'POST', '/api/kv/signals/deploy_log/append', { token, payload: { value: 'v2' } });
    expect((a2.body?.entry as { value: unknown[] }).value).toEqual(['v1', 'v2']);

    // append 到非数组 → 409
    const conflict = await call(app, 'POST', '/api/kv/slots/current_task/append', { token, payload: { value: 'x' } });
    expect(conflict.status).toBe(409);

    // 列表按 namespace
    const listed = await call(app, 'GET', '/api/kv/slots', { token });
    const entries = listed.body?.entries as Array<{ key: string }>;
    expect(entries.some((e) => e.key === 'current_task')).toBe(true);
    expect(entries.some((e) => e.key === 'deploy_log')).toBe(false);

    // namespace / key 校验
    const badNs = await call(app, 'PUT', '/api/kv/BadNS/k', { token, payload: { value: 1 } });
    expect(badNs.status).toBe(400);
    const badKey = await call(app, 'GET', '/api/kv/slots/bad key!', { token });
    expect(badKey.status).toBe(400);

    // ttl 过期即删
    await call(app, 'PUT', '/api/kv/leases/worker1', { token, payload: { value: 'holder', ttlSeconds: 1 } });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const expired = await call(app, 'GET', '/api/kv/leases/worker1', { token });
    expect(expired.status).toBe(404);

    // 删除
    const del = await call(app, 'DELETE', '/api/kv/slots/current_task', { token });
    expect(del.status).toBe(204);
    const gone = await call(app, 'GET', '/api/kv/slots/current_task', { token });
    expect(gone.status).toBe(404);

    // 未认证
    const anon = await call(app, 'GET', '/api/kv/slots', {});
    expect(anon.status).toBe(401);
  });

  it('graph: query matches nodes with 1-hop edges, relations rank by overlap', async () => {
    const m1 = await call(app, 'POST', '/api/memories', {
      token,
      payload: { content: '图谱测试记忆-甲', tags: ['graph-tag'], project: 'graph-proj', sessionId: 'graph-sess', type: 'architecture' },
    });
    const m2 = await call(app, 'POST', '/api/memories', {
      token,
      payload: { content: '图谱测试记忆-乙', tags: ['graph-tag'], project: 'graph-proj', type: 'architecture' },
    });
    const id1 = (m1.body?.memory as { id: string }).id;
    const id2 = (m2.body?.memory as { id: string }).id;

    const graph = await call(app, 'GET', '/api/graph/query?q=graph-tag', { token });
    expect(graph.status).toBe(200);
    const nodes = graph.body?.nodes as Array<{ id: string; kind: string; name: string }>;
    const edges = graph.body?.edges as Array<{ from: string; to: string; relation: string }>;
    expect(nodes.some((n) => n.id === 'tag:graph-tag' && n.kind === 'tag')).toBe(true);
    // 1 跳：tag 节点的邻边把记忆与邻节点带出来
    expect(edges.some((e) => e.relation === 'has_tag' && e.to === 'tag:graph-tag')).toBe(true);
    expect(nodes.some((n) => n.id === `mem:${id1}`)).toBe(true);

    const relations = await call(app, 'GET', `/api/memories/${id1}/relations`, { token });
    const related = relations.body?.related as Array<{ id: string }>;
    expect(related.some((r) => r.id === id2)).toBe(true);
  });

  it('snapshots: create, list, restore round-trip', async () => {
    const created = await call(app, 'POST', '/api/memories', {
      token,
      payload: { content: '快照往返记忆', tags: ['snapshot-me'] },
    });
    const memoryId = (created.body?.memory as { id: string }).id;

    const snap = await call(app, 'POST', '/api/snapshots', { token, payload: { note: 'before-delete' } });
    expect(snap.status).toBe(201);
    const snapshot = snap.body?.snapshot as { id: string; memoryCount: number; note: string };
    expect(snapshot.note).toBe('before-delete');
    expect(snapshot.memoryCount).toBeGreaterThan(0);
    expect(snap.body?.snapshot).not.toHaveProperty('data');

    const listed = await call(app, 'GET', '/api/snapshots', { token });
    const snapshots = listed.body?.snapshots as Array<{ id: string }>;
    expect(snapshots.some((s) => s.id === snapshot.id)).toBe(true);
    expect(JSON.stringify(listed.body)).not.toContain('"data"');

    // 删除后回放
    await call(app, 'DELETE', `/api/memories/${memoryId}`, { token });
    const missing = await call(app, 'GET', `/api/memories/${memoryId}`, { token });
    expect(missing.status).toBe(404);

    const restored = await call(app, 'POST', `/api/snapshots/${snapshot.id}/restore`, {
      token,
      payload: { strategy: 'skip' },
    });
    expect((restored.body as { imported: number }).imported).toBeGreaterThanOrEqual(1);
    const back = await call(app, 'GET', `/api/memories/${memoryId}`, { token });
    expect(back.status).toBe(200);
  });

  it('share: invitation until accept, redacted copy is idempotent, unknown email matches a real invite', async () => {
    const secret = 'sk-aaaaaaaabbbbbbbbccccccccdddddddd';
    const created = await call(app, 'POST', '/api/memories', {
      token,
      payload: { content: `共享知识：api_key = ${secret} 要保密`, tags: ['kb'], project: 'shared-proj' },
    });
    const sourceId = (created.body?.memory as { id: string }).id;

    const shared = await call(app, 'POST', `/api/memories/${sourceId}/share`, {
      token,
      payload: { email: 'Sub-B@Example.com' },
    });
    expect(shared.status).toBe(200);
    expect(shared.body).toEqual({ shared: true, delivery: 'pending' });

    // 接受前不进入对方的库、列表或 shared feed
    const feedBefore = await call(app, 'GET', '/api/memories/shared-feed', { token: tokenB });
    expect(JSON.stringify(feedBefore.body)).not.toContain('共享知识');
    const listBefore = await call(app, 'GET', '/api/memories', { token: tokenB });
    expect(JSON.stringify(listBefore.body)).not.toContain('共享知识');

    // 再次分享（小写邮箱）仍是同一条 pending 邀请
    const sharedAgain = await call(app, 'POST', `/api/memories/${sourceId}/share`, {
      token,
      payload: { email: 'sub-b@example.com' },
    });
    expect(sharedAgain.body).toEqual({ shared: true, delivery: 'pending' });

    const incoming = await call(app, 'GET', '/api/shares/incoming', { token: tokenB });
    expect(incoming.status).toBe(200);
    const invites = incoming.body?.invites as Array<{
      id: string;
      fromEmail: string;
      fromDisplayName: string | null;
      memoryId: string;
      content: string;
      project: string | null;
      createdAt: string;
    }>;
    expect(invites).toHaveLength(1);
    const invite = invites[0]!;
    expect(invite.fromEmail).toBe('sub-a@example.com');
    expect(invite.fromDisplayName).toBe('sub-a');
    expect(invite.memoryId).toBe(sourceId);
    expect(invite.project).toBe('shared-proj');
    expect(invite.content).toContain('共享知识');
    expect(invite.content).not.toContain(secret);
    expect(invite.createdAt).toEqual(expect.any(String));

    // 未知邮箱、分享给自己：与新建邀请相同的 200，且不产生邀请或记忆
    const missing = await call(app, 'POST', `/api/memories/${sourceId}/share`, {
      token,
      payload: { email: 'Nobody@Example.com' },
    });
    const self = await call(app, 'POST', `/api/memories/${sourceId}/share`, {
      token,
      payload: { email: 'Sub-A@Example.com' },
    });
    expect(missing.status).toBe(shared.status);
    expect(missing.body).toEqual(shared.body);
    expect(self.status).toBe(shared.status);
    expect(self.body).toEqual(shared.body);

    const incomingAfter = await call(app, 'GET', '/api/shares/incoming', { token: tokenB });
    expect(incomingAfter.body?.invites).toHaveLength(1);
    const senderIncoming = await call(app, 'GET', '/api/shares/incoming', { token });
    expect(senderIncoming.body?.invites).toEqual([]);
    const senderList = await call(app, 'GET', '/api/memories', { token });
    const senderCopies = (senderList.body?.memories as Array<{ eventId: string | null }>).filter((m) =>
      m.eventId?.includes(`share:${sourceId}:`),
    );
    expect(senderCopies).toHaveLength(0);
    const recipientList = await call(app, 'GET', '/api/memories', { token: tokenB });
    expect(JSON.stringify(recipientList.body)).not.toContain('共享知识');

    // 别人不能接受
    const foreign = await call(app, 'POST', `/api/shares/${invite.id}/accept`, { token });
    expect(foreign.status).toBe(404);

    // 拒绝不复制；再次分享把同一条邀请重开为 pending
    const rejected = await call(app, 'POST', `/api/shares/${invite.id}/reject`, { token: tokenB });
    expect(rejected.status).toBe(200);
    expect(rejected.body).toEqual({ delivery: 'rejected' });
    const afterReject = await call(app, 'GET', '/api/memories', { token: tokenB });
    expect(JSON.stringify(afterReject.body)).not.toContain('共享知识');
    const feedRejected = await call(app, 'GET', '/api/memories/shared-feed', { token: tokenB });
    expect(JSON.stringify(feedRejected.body)).not.toContain('共享知识');
    const hidden = await call(app, 'GET', '/api/shares/incoming', { token: tokenB });
    expect(hidden.body?.invites).toEqual([]);

    const reopened = await call(app, 'POST', `/api/memories/${sourceId}/share`, {
      token,
      payload: { email: 'sub-b@example.com' },
    });
    expect(reopened.body).toEqual({ shared: true, delivery: 'pending' });
    const reopenedList = await call(app, 'GET', '/api/shares/incoming', { token: tokenB });
    const pending = reopenedList.body?.invites as Array<{ id: string }>;
    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe(invite.id);

    const beforeAccept = await call(app, 'GET', '/api/audit?limit=200', { token });
    const beforeActions = (beforeAccept.body?.entries as Array<{ action: string }>).map((e) => e.action);
    expect(beforeActions).toContain('memory.share_invite');
    expect(beforeActions).not.toContain('memory.share');

    const accepted = await call(app, 'POST', `/api/shares/${invite.id}/accept`, { token: tokenB });
    expect(accepted.status).toBe(200);
    expect(accepted.body?.delivery).toBe('accepted');
    const acceptedMemory = accepted.body?.memory as { id: string; content: string; tags: string[]; eventId: string };
    expect(acceptedMemory.content).not.toContain(secret);
    expect(acceptedMemory.tags).toEqual(expect.arrayContaining(['shared', 'kb']));
    expect(acceptedMemory.eventId).toContain(`share:${sourceId}:`);

    const feed = await call(app, 'GET', '/api/memories/shared-feed', { token: tokenB });
    const items = feed.body?.memories as Array<{ content: string; tags: string[]; eventId: string; project: string | null }>;
    const copies = items.filter((m) => m.content.includes('共享知识'));
    expect(copies).toHaveLength(1);
    expect(copies[0]?.tags).toEqual(expect.arrayContaining(['shared', 'kb']));
    expect(copies[0]?.content).not.toContain(secret);
    expect(copies[0]?.eventId).toContain(`share:${sourceId}:`);
    expect(copies[0]?.project).toBe('shared-proj');

    // 再次接受、再次分享都不产生第二份
    const acceptedAgain = await call(app, 'POST', `/api/shares/${invite.id}/accept`, { token: tokenB });
    expect(acceptedAgain.status).toBe(200);
    expect(acceptedAgain.body?.delivery).toBe('accepted');
    expect((acceptedAgain.body?.memory as { id: string }).id).toBe(acceptedMemory.id);
    const reshare = await call(app, 'POST', `/api/memories/${sourceId}/share`, {
      token,
      payload: { email: 'sub-b@example.com' },
    });
    expect(reshare.body).toEqual({ shared: true, delivery: 'accepted' });
    const again = await call(app, 'GET', '/api/memories/shared-feed', { token: tokenB });
    const againCopies = (again.body?.memories as Array<{ content: string }>).filter((m) => m.content.includes('共享知识'));
    expect(againCopies).toHaveLength(1);
    const listed = await call(app, 'GET', '/api/memories', { token: tokenB });
    const listedCopies = (listed.body?.memories as Array<{ content: string }>).filter((m) => m.content.includes('共享知识'));
    expect(listedCopies).toHaveLength(1);

    const afterAccept = await call(app, 'GET', '/api/audit?limit=200', { token });
    const afterActions = (afterAccept.body?.entries as Array<{ action: string }>).map((e) => e.action);
    expect(afterActions).toContain('memory.share');

    // 源用户的 feed 不含自己的记忆；别人不能分享这条记忆
    const ownFeed = await call(app, 'GET', '/api/memories/shared-feed', { token });
    expect(JSON.stringify(ownFeed.body)).not.toContain('共享知识');
    const notMine = await call(app, 'POST', `/api/memories/${sourceId}/share`, {
      token: tokenB,
      payload: { email: 'sub-a@example.com' },
    });
    expect(notMine.status).toBe(404);
    expect((notMine.body?.error as { message: string }).message).toBe('记忆不存在');
  });

  it('crystallize: manual session crystallization is idempotent within the hour', async () => {
    for (let i = 0; i < 3; i += 1) {
      await call(app, 'POST', '/api/hooks/events', {
        token,
        payload: {
          eventId: `sess-crystal:evt-00000${i}`,
          hook: 'PostToolUse',
          content: `结晶观察 ${i}：调整了索引重建的批量大小，并验证了新索引的召回质量`,
          sessionId: 'sess-crystal',
          toolName: 'Edit',
        },
      });
    }
    const first = await call(app, 'POST', '/api/sessions/sess-crystal/crystallize', { token });
    expect(first.status).toBe(200);
    const memory = first.body?.memory as { id: string; origin: string; content: string; eventId: string };
    expect(memory.origin).toBe('summary');
    expect(memory.content).toContain('会话摘要');
    expect(memory.eventId.startsWith('crystal:sess-crystal:')).toBe(true);

    const second = await call(app, 'POST', '/api/sessions/sess-crystal/crystallize', { token });
    expect((second.body?.memory as { id: string }).id).toBe(memory.id);

    const timeline = await call(app, 'GET', '/api/sessions/sess-crystal', { token });
    const summaries = (timeline.body?.memories as Array<{ eventId: string | null }>).filter((m) =>
      m.eventId?.startsWith('crystal:'),
    );
    expect(summaries).toHaveLength(1);
  });

  it('admin: diagnose reports expired memories, heal cleans them up', async () => {
    const clean = await call(app, 'GET', '/api/admin/diagnose', { token });
    expect(clean.status).toBe(200);
    expect(clean.body).toHaveProperty('ok');
    expect(clean.body).toHaveProperty('problems');
    expect(clean.body).toHaveProperty('stats');
    // standin 配置齐全，不应报检索配置问题
    const codes = (clean.body?.problems as Array<{ code: string }>).map((p) => p.code);
    expect(codes).not.toContain('MEILI_NOT_CONFIGURED');
    expect(codes).not.toContain('QDRANT_NOT_CONFIGURED');
    expect(codes).not.toContain('EMBEDDING_NOT_CONFIGURED');

    await call(app, 'POST', '/api/memories', {
      token,
      payload: { content: '过期记忆-待自愈', expiresAt: new Date(Date.now() - 1000).toISOString() },
    });
    const dirty = await call(app, 'GET', '/api/admin/diagnose', { token });
    const dirtyCodes = (dirty.body?.problems as Array<{ code: string }>).map((p) => p.code);
    expect(dirtyCodes).toContain('EXPIRED_MEMORIES');
    expect(dirty.body?.ok).toBe(false);

    const healed = await call(app, 'POST', '/api/admin/heal', { token });
    expect(healed.status).toBe(200);
    const heal = healed.body as { reindexed: number; autoForget: { deleted: number; expired: number } };
    expect(heal.autoForget.expired).toBeGreaterThanOrEqual(1);
    expect(heal.autoForget.deleted).toBeGreaterThanOrEqual(1);

    const after = await call(app, 'GET', '/api/admin/diagnose', { token });
    const afterCodes = (after.body?.problems as Array<{ code: string }>).map((p) => p.code);
    expect(afterCodes).not.toContain('EXPIRED_MEMORIES');
  });

  it('consolidate: merges duplicate chains by contentHash, dryRun only reports', async () => {
    const dupImport = await call(app, 'POST', '/api/memories/import', {
      token,
      payload: {
        memories: [
          { content: '重复链-合并目标', tags: ['dup'] },
          { content: '重复链-合并目标', tags: ['dup'] },
          { content: '重复链-合并目标', tags: ['dup'] },
        ],
      },
    });
    expect((dupImport.body as { imported: number }).imported).toBe(3);

    const dry = await call(app, 'POST', '/api/memories/consolidate', { token, payload: { dryRun: true } });
    const dryResult = dry.body as { groups: number; merged: number };
    expect(dryResult.groups).toBeGreaterThanOrEqual(1);
    expect(dryResult.merged).toBeGreaterThanOrEqual(2);

    // dryRun 不删
    const beforeReal = await call(app, 'GET', '/api/memories?tags=dup', { token });
    expect((beforeReal.body?.memories as unknown[]).length).toBe(3);

    const real = await call(app, 'POST', '/api/memories/consolidate', { token, payload: {} });
    expect((real.body as { merged: number }).merged).toBeGreaterThanOrEqual(2);
    const after = await call(app, 'GET', '/api/memories?tags=dup', { token });
    expect((after.body?.memories as unknown[]).length).toBe(1);

    // 收敛后再跑为零
    const again = await call(app, 'POST', '/api/memories/consolidate', { token, payload: {} });
    expect((again.body as { groups: number }).groups).toBe(0);
  });

  it('reflect: summarizes recent lessons/patterns/bugs, idempotent per day', async () => {
    await call(app, 'POST', '/api/memories', {
      token,
      payload: { content: '教训：重建索引前要先排空写入队列', type: 'lesson' },
    });
    await call(app, 'POST', '/api/memories', {
      token,
      payload: { content: '缺陷：快照恢复时 strategy 默认值未传递', type: 'bug' },
    });

    const first = await call(app, 'POST', '/api/memories/reflect', { token, payload: {} });
    expect(first.status).toBe(200);
    const memory = first.body?.memory as { id: string; type: string; origin: string; content: string; eventId: string };
    expect(memory.type).toBe('pattern');
    expect(memory.origin).toBe('agent');
    expect(memory.content).toContain('反思');
    expect(memory.content).toContain('lesson');
    expect(memory.eventId.startsWith('reflect:')).toBe(true);
    expect(first.body?.deduped).toBe(false);

    // 当日幂等：同一事件 id，不生成第二条
    const second = await call(app, 'POST', '/api/memories/reflect', { token, payload: {} });
    expect(second.body?.deduped).toBe(true);
    expect((second.body?.memory as { id: string }).id).toBe(memory.id);
  });

  it('audit: records delete / share / restore / heal / import actions', async () => {
    const audit = await call(app, 'GET', '/api/audit?limit=200', { token });
    expect(audit.status).toBe(200);
    const actions = (audit.body?.entries as Array<{ action: string }>).map((e) => e.action);
    expect(actions).toContain('memory.delete');
    expect(actions).toContain('memory.share');
    expect(actions).toContain('snapshot.restore');
    expect(actions).toContain('admin.heal');
    expect(actions).toContain('memory.import');

    // 新增一次删除，计数 +1
    const countBefore = actions.filter((a) => a === 'memory.delete').length;
    const created = await call(app, 'POST', '/api/memories', { token, payload: { content: '审计计数目标' } });
    const id = (created.body?.memory as { id: string }).id;
    await call(app, 'DELETE', `/api/memories/${id}`, { token });
    const after = await call(app, 'GET', '/api/audit?limit=200', { token });
    const afterActions = (after.body?.entries as Array<{ action: string }>).map((e) => e.action);
    expect(afterActions.filter((a) => a === 'memory.delete').length).toBe(countBefore + 1);

    // 他人看不到我的审计
    const foreign = await call(app, 'GET', '/api/audit', { token: tokenB });
    expect((foreign.body?.entries as unknown[]).length).toBe(0);

    // cookie 会话同样可用
    const viaCookie = await call(app, 'GET', '/api/audit?limit=5', { cookie });
    expect(viaCookie.status).toBe(200);
  });
});
