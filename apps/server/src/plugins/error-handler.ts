import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../errors.js';

function send(reply: FastifyReply, status: number, code: string, message: string): void {
  void reply.status(status).send({ error: { code, message } });
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | Error, req: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof ZodError) {
      send(reply, 400, 'VALIDATION', '请求参数不正确');
      return;
    }
    if (error instanceof AppError) {
      send(reply, error.status, error.code, error.message);
      return;
    }
    const statusCode = 'statusCode' in error ? error.statusCode : undefined;
    if (statusCode === 400) {
      send(reply, 400, 'VALIDATION', '请求参数不正确');
      return;
    }
    req.log.error(error);
    send(reply, 500, 'INTERNAL', '服务器错误');
  });
}
