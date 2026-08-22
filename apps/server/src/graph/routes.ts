import type { GraphEdge, GraphNode, GraphQueryResult, MemoryPublic } from '@agent-recall/dto';
import { and, eq, gte, isNull, ne, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireActor } from '../auth/authenticate.js';
import { memories } from '../db/schema.js';
import { getMemory, toMemory, type MemoryDeps } from '../memories/service.js';

function deps(app: FastifyInstance): MemoryDeps {
  return { db: app.ctx.db, retrieval: app.ctx.retrieval, encryptionKey: app.ctx.config.ENCRYPTION_KEY };
}

function buildGraph(rows: MemoryPublic[]): { nodes: Map<string, GraphNode>; edges: GraphEdge[] } {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const addNode = (node: GraphNode) => {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  };
  for (const m of rows) {
    const memId = `mem:${m.id}`;
    addNode({ id: memId, kind: 'memory', name: m.content.replace(/\s+/g, ' ').trim().slice(0, 80) });
    if (m.project) {
      const id = `project:${m.project}`;
      addNode({ id, kind: 'project', name: m.project });
      edges.push({ from: memId, to: id, relation: 'belongs_to' });
    }
    for (const tag of m.tags) {
      const id = `tag:${tag}`;
      addNode({ id, kind: 'tag', name: tag });
      edges.push({ from: memId, to: id, relation: 'has_tag' });
    }
    if (m.sessionId) {
      const id = `session:${m.sessionId}`;
      addNode({ id, kind: 'session', name: m.sessionId });
      edges.push({ from: memId, to: id, relation: 'in_session' });
    }
    const typeId = `type:${m.type}`;
    addNode({ id: typeId, kind: 'type', name: m.type });
    edges.push({ from: memId, to: typeId, relation: 'is_type' });
  }
  return { nodes, edges };
}

export function registerGraphRoutes(app: FastifyInstance): void {
  /**
   * 图谱查询：节点与边全部由记忆的结构化字段派生，零维护。
   * q 对节点名做 ILIKE 过滤，返回匹配节点 + 它们的 1 跳边与邻节点。
   */
  app.get('/api/graph/query', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    const q = req.query as { q?: string; limit?: string };
    const parsed = q.limit ? Number.parseInt(q.limit, 10) : NaN;
    const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 500) : 50;

    const rows = await deps(app)
      .db.select()
      .from(memories)
      .where(
        and(
          eq(memories.userId, actor.userId),
          eq(memories.isLatest, true),
          or(isNull(memories.expiresAt), gte(memories.expiresAt, new Date())),
        ),
      )
      .limit(1000);
    const { nodes, edges } = buildGraph(rows.map(toMemory));

    const needle = (q.q ?? '').trim().toLowerCase();
    let matched: GraphNode[];
    if (needle) {
      matched = [...nodes.values()].filter((n) => n.name.toLowerCase().includes(needle)).slice(0, limit);
    } else {
      matched = [...nodes.values()].slice(0, limit);
    }
    const keep = new Set(matched.map((n) => n.id));
    const keptEdges = edges.filter((e) => keep.has(e.from) || keep.has(e.to));
    // 1 跳邻节点也要带上
    for (const e of keptEdges) {
      keep.add(e.from);
      keep.add(e.to);
    }
    const result: GraphQueryResult = {
      nodes: [...keep].flatMap((id) => {
        const node = nodes.get(id);
        return node ? [node] : [];
      }),
      edges: keptEdges,
    };
    return result;
  });

  /** 相关记忆：共享 tag/project/sessionId/type 的其他最新版记忆，按重叠维度数排序 */
  app.get('/api/memories/:id/relations', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const target = await getMemory(deps(app), actor.userId, id);

    const rows = await deps(app)
      .db.select()
      .from(memories)
      .where(
        and(
          eq(memories.userId, actor.userId),
          eq(memories.isLatest, true),
          ne(memories.chainId, target.chainId),
          or(isNull(memories.expiresAt), gte(memories.expiresAt, new Date())),
        ),
      )
      .limit(1000);

    const scored = rows
      .map(toMemory)
      .map((m) => {
        let overlap = 0;
        if (m.project && m.project === target.project) overlap += 1;
        if (m.sessionId && m.sessionId === target.sessionId) overlap += 1;
        if (m.type === target.type) overlap += 1;
        if (m.tags.some((t) => target.tags.includes(t))) overlap += 1;
        return { m, overlap };
      })
      .filter((r) => r.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap || b.m.createdAt.localeCompare(a.m.createdAt))
      .slice(0, 20);
    return { related: scored.map((r) => r.m) };
  });
}
