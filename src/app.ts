import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { corsOrigins, env } from './config/env.js';
import type { Container } from './container.js';
import { categoryRoutes } from './modules/categories/category.routes.js';
import { crawlJobRoutes } from './modules/crawl-jobs/crawl-job.routes.js';
import { healthRoutes, type HealthChecks } from './modules/health/health.routes.js';
import { productRoutes } from './modules/products/product.routes.js';
import { sourceRoutes } from './modules/sources/source.routes.js';
import { errorHandler, notFoundHandler } from './shared/errors/error-handler.js';

export interface AppDeps {
  container: Container;
  health: HealthChecks;
  /** Redis para o rate limit compartilhado entre instâncias (opcional: usa memória). */
  rateLimitRedis?: Redis;
  logger?: FastifyServerOptions['logger'];
}

export const API_PREFIX = '/api/v1';

function loggerOptions(): FastifyServerOptions['logger'] {
  return {
    level: env.LOG_LEVEL,
    // Nunca registrar credenciais/cookies.
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-api-key"]',
        'res.headers["set-cookie"]',
      ],
      censor: '[REDACTED]',
    },
    ...(env.NODE_ENV === 'development' && {
      transport: {
        target: 'pino-pretty',
        options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
    }),
  };
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.logger ?? loggerOptions(),
    bodyLimit: env.BODY_LIMIT,
    requestTimeout: env.REQUEST_TIMEOUT,
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
    trustProxy: true,
    routerOptions: { ignoreTrailingSlash: true },
  });

  // Validação: Zod nos controllers é a única fonte de verdade. Os JSON Schemas das rotas
  // (gerados a partir do Zod) servem para a documentação OpenAPI.
  app.setValidatorCompiler(() => (data) => ({ value: data }));
  app.setSerializerCompiler(() => (data) => JSON.stringify(data));

  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  await app.register(helmet, {
    // CSP relaxada apenas o necessário para a Swagger UI funcionar.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'validator.swagger.io'],
        scriptSrc: ["'self'"],
      },
    },
  });
  await app.register(cors, {
    origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  });
  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    ...(deps.rateLimitRedis && { redis: deps.rateLimitRedis, nameSpace: 'catalog:ratelimit:' }),
    errorResponseBuilder: (_request, context) => ({
      statusCode: context.statusCode,
      code: 'RATE_LIMIT_EXCEEDED',
      message: `Rate limit exceeded, retry in ${context.after}`,
    }),
  });

  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Catalog Service',
        description:
          'Catálogo de produtos de moda para o provador virtual. Os produtos são coletados ' +
          'de forma assíncrona por crawlers e servidos a partir do PostgreSQL (com cache Redis).',
        version: '0.1.0',
      },
      tags: [
        { name: 'products', description: 'Busca e detalhe de produtos' },
        { name: 'categories', description: 'Categorias hierárquicas' },
        { name: 'sources', description: 'Lojas/fontes e sincronização' },
        { name: 'health', description: 'Health checks' },
      ],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  const { controllers } = deps.container;
  await app.register(healthRoutes(deps.health));
  await app.register(
    async (api) => {
      await api.register(productRoutes(controllers.products));
      await api.register(categoryRoutes(controllers.categories));
      await api.register(sourceRoutes(controllers.sources));
      await api.register(crawlJobRoutes(controllers.crawlJobs));
    },
    { prefix: API_PREFIX },
  );

  return app;
}
