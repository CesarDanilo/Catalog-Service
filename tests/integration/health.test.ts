import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { buildTestApp } from '../helpers/app.js';
import { closeConnections } from '../helpers/db.js';

let app: FastifyInstance;

beforeAll(async () => {
  ({ app } = await buildTestApp());
});

afterAll(async () => {
  await app.close();
  await closeConnections();
});

describe('health', () => {
  it.each(['/health', '/health/database', '/health/redis'])('GET %s -> ok', async (url) => {
    const response = await app.inject({ url });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('retorna 503 quando a dependência está fora', async () => {
    const { container } = await buildTestApp();
    const broken = await buildApp({
      container,
      logger: false,
      health: {
        database: async () => {
          throw new Error('connection refused');
        },
        redis: async () => {},
      },
    });
    const response = await broken.inject({ url: '/health/database' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: 'error',
      error: { code: 'DATABASE_UNAVAILABLE' },
    });
    await broken.close();
  });

  it('expõe a documentação OpenAPI com todos os endpoints', async () => {
    const response = await app.inject({ url: '/docs/json' });
    expect(response.statusCode).toBe(200);
    const paths = Object.keys(response.json().paths);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/api/v1/products',
        '/api/v1/products/search',
        '/api/v1/products/{id}',
        '/api/v1/categories',
        '/api/v1/sources',
        '/api/v1/sources/{id}',
        '/api/v1/sources/{id}/sync',
        '/api/v1/crawl-jobs/{id}',
      ]),
    );
  });
});
