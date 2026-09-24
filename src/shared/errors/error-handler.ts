import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from './app-error.js';

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

function formatZodIssues(error: ZodError) {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

export function errorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  if (error instanceof ZodError) {
    return reply.status(400).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request',
        details: formatZodIssues(error),
      },
    } satisfies ErrorBody);
  }

  if (error instanceof AppError) {
    if (error.statusCode >= 500) request.log.error({ err: error }, error.message);
    const body: ErrorBody = { error: { code: error.code, message: error.message } };
    if (error.details !== undefined) body.error.details = error.details;
    return reply.status(error.statusCode).send(body);
  }

  // Erros do próprio Fastify (rate limit, payload grande, JSON inválido...).
  const statusCode = 'statusCode' in error && error.statusCode ? error.statusCode : 500;
  if (statusCode < 500) {
    const code = 'code' in error && error.code ? error.code : 'BAD_REQUEST';
    return reply.status(statusCode).send({ error: { code, message: error.message } });
  }

  // Nunca expõe stack trace ou mensagens internas ao cliente.
  request.log.error({ err: error }, 'unhandled error');
  return reply.status(500).send({
    error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' },
  } satisfies ErrorBody);
}

export function notFoundHandler(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return reply.status(404).send({
    error: { code: 'ROUTE_NOT_FOUND', message: `Route ${request.method} ${request.url} not found` },
  } satisfies ErrorBody);
}
