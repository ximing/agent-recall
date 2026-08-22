import { exportResultSchema, meshSyncSchema, type MeshSyncResult } from '@agent-recall/dto';
import type { FastifyInstance } from 'fastify';
import { requireActor } from '../auth/authenticate.js';
import { AppError } from '../errors.js';
import { importMemories } from '../memories/governance.js';
import type { MemoryDeps } from '../memories/service.js';

function deps(app: FastifyInstance): MemoryDeps {
  return { db: app.ctx.db, retrieval: app.ctx.retrieval, encryptionKey: app.ctx.config.ENCRYPTION_KEY };
}

/** SSRF 防护：只允许私网/loopback 目标 */
function assertPrivatePeer(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError(400, 'VALIDATION', 'peerUrl 不是合法 URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError(400, 'VALIDATION', 'peerUrl 仅允许 http(s)');
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1') return url;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) throw new AppError(400, 'VALIDATION', 'peerUrl 主机必须是私网或 loopback 地址');
  const a = Number(m[1]);
  const b = Number(m[2]);
  const privateV4 =
    a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  if (!privateV4) throw new AppError(400, 'VALIDATION', 'peerUrl 主机必须是私网或 loopback 地址');
  return url;
}

export function registerMeshRoutes(app: FastifyInstance): void {
  /** Mesh 同步：拉取 peer 的导出并在本地导入 */
  app.post('/api/mesh/sync', { preHandler: [app.authenticate] }, async (req) => {
    const actor = requireActor(req);
    const input = meshSyncSchema.parse(req.body);
    const peer = assertPrivatePeer(input.peerUrl);
    const exportUrl = `${peer.origin}/api/memories/export`;

    let payload: unknown;
    try {
      const res = await fetch(exportUrl, {
        headers: { authorization: `Bearer ${input.peerToken}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new AppError(502, 'PEER_ERROR', `peer 返回 ${res.status}`);
      payload = await res.json();
    } catch (err) {
      if (err instanceof AppError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new AppError(502, 'PEER_ERROR', `peer 不可达：${message}`);
    }
    const data = exportResultSchema.parse(payload);
    const result = await importMemories(deps(app), actor.userId, {
      memories: data.memories,
      strategy: input.strategy ?? 'skip',
    });
    const out: MeshSyncResult = {
      peerCount: data.memories.length,
      imported: result.imported,
      skipped: result.skipped,
      replaced: result.replaced,
    };
    return out;
  });
}
