import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { createContainer } from '../../src/container.js';
import { prisma } from '../../src/infrastructure/database/prisma.js';
import { redis } from '../../src/infrastructure/redis/redis.js';
import { FakeQueue } from '../helpers/app.js';
import { buildGoogleShoppingTestApp, MemoryCache } from '../helpers/google-shopping.js';

/** Rate limit global + allowlist do backend, no app completo (sem Postgres/Redis). */
describe('rate limit com allowlist', () => {
  let app: FastifyInstance;
  const BACKEND_IP = '172.31.37.117';

  beforeAll(async () => {
    const container = createContainer({
      prisma,
      redis,
      queue: new FakeQueue(),
      hasCrawler: () => true,
      cache: new MemoryCache(),
    });
    app = await buildApp({
      container,
      health: { database: async () => undefined, redis: async () => undefined },
      logger: false,
      rateLimitAllowList: BACKEND_IP,
    });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  // /api/v1/providers/x/search responde 404 sem tocar em banco — serve pra contar requisições.
  const hit = (remoteAddress: string) =>
    app.inject({ method: 'GET', url: '/api/v1/providers/x/search?q=a', remoteAddress });

  it('o backend (allowlist) passa do limite global; outro IP recebe 429', async () => {
    const max = Number(process.env.RATE_LIMIT_MAX);
    const backend = await Promise.all(Array.from({ length: max + 20 }, () => hit(BACKEND_IP)));
    expect(backend.filter((r) => r.statusCode === 429)).toHaveLength(0);

    const other = await Promise.all(Array.from({ length: max + 20 }, () => hit('198.51.100.7')));
    expect(other.filter((r) => r.statusCode === 429).length).toBeGreaterThan(0);
  });
});

describe('limite próprio da busca ao vivo (30/min)', () => {
  it('também respeita a allowlist', async () => {
    // app.inject usa 127.0.0.1 como IP da conexão.
    const { app, fetcher } = await buildGoogleShoppingTestApp({
      maxQueue: 50,
      rateLimitAllowList: '127.0.0.1',
    });
    try {
      const statuses = [];
      for (let i = 0; i < 35; i++) {
        const response = await app.inject({
          method: 'GET',
          url: '/api/v1/providers/google-shopping/search',
          query: { q: `t${i}` },
        });
        statuses.push(response.statusCode);
      }
      expect(statuses.filter((status) => status === 429)).toHaveLength(0);
      expect(fetcher.calls).toBe(35);
    } finally {
      await app.close();
    }
  });
});
