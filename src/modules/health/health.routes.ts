import type { FastifyInstance, FastifyReply } from 'fastify';

export interface HealthChecks {
  database: () => Promise<void>;
  redis: () => Promise<void>;
}

const statusSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['ok', 'error'] },
    error: {
      type: 'object',
      properties: { code: { type: 'string' }, message: { type: 'string' } },
    },
  },
  required: ['status'],
} as const;

const CHECK_TIMEOUT_MS = 3_000;

function withTimeout(check: () => Promise<void>): Promise<void> {
  return Promise.race([
    check(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Health check timed out')), CHECK_TIMEOUT_MS).unref(),
    ),
  ]);
}

async function runCheck(reply: FastifyReply, name: string, check: () => Promise<void>) {
  try {
    await withTimeout(check);
    return { status: 'ok' };
  } catch (error) {
    reply.log.error({ err: error, dependency: name }, 'health check failed');
    return reply.status(503).send({
      status: 'error',
      error: { code: `${name.toUpperCase()}_UNAVAILABLE`, message: `${name} is unavailable` },
    });
  }
}

/** Health checks ficam fora de /api/v1 e do rate limit (usados por Docker/orquestradores). */
export function healthRoutes(checks: HealthChecks) {
  return async (app: FastifyInstance) => {
    const config = { rateLimit: false };
    const schema = (summary: string) => ({
      tags: ['health'],
      summary,
      response: { 200: statusSchema, 503: statusSchema },
    });

    app.get('/health', { config, schema: schema('Liveness da API') }, async () => ({
      status: 'ok',
    }));
    app.get(
      '/health/database',
      { config, schema: schema('Conectividade com o PostgreSQL') },
      (_, reply) => runCheck(reply, 'database', checks.database),
    );
    app.get('/health/redis', { config, schema: schema('Conectividade com o Redis') }, (_, reply) =>
      runCheck(reply, 'redis', checks.redis),
    );
  };
}
