import type { FastifyReply, FastifyRequest } from 'fastify';
import { userFromAccessToken, userFromSession } from './service.js';
import { readBearerToken, SESSION_COOKIE } from './token-logic.js';
import { AppError } from '../errors.js';
import type { ActorKind } from '../types.js';

export async function authenticate(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const bearer = readBearerToken(req.headers.authorization);
  if (bearer) {
    const token = await userFromAccessToken(req.server.ctx.db, bearer);
    if (!token) throw new AppError(401, 'UNAUTHORIZED', '令牌无效或已吊销');
    req.userId = token.userId;
    req.actor = 'token';
    return;
  }
  const raw = req.cookies[SESSION_COOKIE];
  if (!raw) throw new AppError(401, 'UNAUTHORIZED', '未登录');
  const session = await userFromSession(req.server.ctx.db, raw);
  if (!session) throw new AppError(401, 'UNAUTHORIZED', '未登录');
  req.userId = session.userId;
  req.actor = 'session';
}

export function requireActor(req: FastifyRequest): { userId: string; actor: ActorKind } {
  if (!req.userId || (req.actor !== 'session' && req.actor !== 'token')) {
    throw new AppError(401, 'UNAUTHORIZED', '未登录');
  }
  return { userId: req.userId, actor: req.actor };
}

export function requireSession(req: FastifyRequest): string {
  const actor = requireActor(req);
  if (actor.actor !== 'session') throw new AppError(403, 'FORBIDDEN', '请在网页上管理');
  return actor.userId;
}
