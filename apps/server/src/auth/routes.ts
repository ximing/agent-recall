import { loginSchema, registerSchema } from '@agent-recall/dto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { deleteSession, getUser, loginUser, registerUser } from './service.js';
import { SESSION_COOKIE } from './token-logic.js';

export function setSessionCookie(app: FastifyInstance, reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
    secure: app.ctx.config.COOKIE_SECURE === 'true',
  });
}

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post('/api/auth/register', async (req, reply) => {
    const input = registerSchema.parse(req.body);
    const result = await registerUser(app.ctx.db, input);
    setSessionCookie(app, reply, result.sessionToken);
    return reply.code(201).send({ user: result.user });
  });

  app.post('/api/auth/login', async (req, reply) => {
    const input = loginSchema.parse(req.body);
    const result = await loginUser(app.ctx.db, input);
    setSessionCookie(app, reply, result.sessionToken);
    return { user: result.user };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const raw = req.cookies[SESSION_COOKIE];
    if (raw) await deleteSession(app.ctx.db, raw);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  app.get('/api/auth/me', { preHandler: [app.authenticate] }, async (req) => {
    return { user: await getUser(app.ctx.db, req.userId) };
  });
}
