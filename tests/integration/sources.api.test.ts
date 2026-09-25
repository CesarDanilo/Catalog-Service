import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, FakeQueue } from '../helpers/app.js';
import { closeConnections, prisma, resetDatabase, seedBasics } from '../helpers/db.js';

let app: FastifyInstance;
let queue: FakeQueue;
let sources: Awaited<ReturnType<typeof seedBasics>>['sources'];

beforeAll(async () => {
  queue = new FakeQueue();
  ({ app } = await buildTestApp(queue));
});

beforeEach(async () => {
  await resetDatabase();
  ({ sources } = await seedBasics());
  queue.jobs.length = 0;
  queue.fail = false;
});

afterAll(async () => {
  await app.close();
  await closeConnections();
});

describe('sources API', () => {
  it('GET /sources lista com contagem e disponibilidade de crawler', async () => {
    const { data } = (await app.inject({ url: '/api/v1/sources' })).json();
    expect(data.map((s: { slug: string }) => s.slug)).toEqual(['amazon', 'ca', 'renner']);
    expect(data[0]).toMatchObject({ enabled: false, productsCount: 0, crawlerAvailable: true });
  });

  it('GET /sources/:id e 404', async () => {
    expect((await app.inject({ url: `/api/v1/sources/${sources.ca.id}` })).json().data.slug).toBe(
      'ca',
    );
    const missing = await app.inject({
      url: '/api/v1/sources/00000000-0000-4000-8000-000000000000',
    });
    expect(missing.json().error.code).toBe('SOURCE_NOT_FOUND');
  });

  it('PATCH /sources/:id atualiza configuração', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/sources/${sources.renner.id}`,
      payload: { enabled: false, crawlInterval: 720, config: { categories: ['vestidos'] } },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      enabled: false,
      crawlInterval: 720,
      config: { categories: ['vestidos'] },
    });
  });

  it('PATCH valida o corpo (whitelist de campos)', async () => {
    for (const payload of [{}, { slug: 'hack' }, { crawlInterval: 1 }, { baseUrl: 'ftp://x' }]) {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/sources/${sources.renner.id}`,
        payload,
      });
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it('POST /sources/:id/sync cria CrawlJob PENDING e enfileira', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/sources/${sources.ca.id}/sync`,
      payload: { limit: 10 },
    });
    expect(response.statusCode).toBe(202);
    const job = response.json().data;
    expect(job).toMatchObject({ status: 'PENDING', params: { mode: 'crawl', limit: 10 } });
    expect(queue.jobs).toEqual([{ crawlJobId: job.id, sourceId: sources.ca.id }]);

    const status = await app.inject({ url: `/api/v1/crawl-jobs/${job.id}` });
    expect(status.json().data.status).toBe('PENDING');

    const history = (await app.inject({ url: `/api/v1/sources/${sources.ca.id}/jobs` })).json();
    expect(history.pagination.total).toBe(1);
  });

  it('sync sem corpo usa o modo crawl', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/sources/${sources.ca.id}/sync`,
    });
    expect(response.statusCode).toBe(202);
    expect(response.json().data.params).toEqual({ mode: 'crawl' });
  });

  it.each([
    ['fonte desabilitada', () => sources.amazon.id, undefined, 'SOURCE_DISABLED', 409],
    ['search sem query', () => sources.ca.id, { mode: 'search' }, 'VALIDATION_ERROR', 400],
  ])('sync rejeita %s', async (_label, id, payload, code, status) => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/sources/${id()}/sync`,
      payload,
    });
    expect(response.statusCode).toBe(status);
    expect(response.json().error.code).toBe(code);
    expect(queue.jobs).toHaveLength(0);
  });

  it('sync rejeita fonte sem crawler registrado', async () => {
    const other = await prisma.source.create({
      data: { name: 'X', slug: 'x', baseUrl: 'https://x.test' },
    });
    const response = await app.inject({ method: 'POST', url: `/api/v1/sources/${other.id}/sync` });
    expect(response.json().error.code).toBe('CRAWLER_NOT_AVAILABLE');
  });

  it('sync rejeita quando já existe crawl ativo para a fonte', async () => {
    await app.inject({ method: 'POST', url: `/api/v1/sources/${sources.ca.id}/sync` });
    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/sources/${sources.ca.id}/sync`,
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('CRAWL_ALREADY_RUNNING');
  });

  it('busca sob demanda não é bloqueada pela sincronização completa (e vice-versa)', async () => {
    await prisma.crawlJob.deleteMany({ where: { sourceId: sources.ca.id } });
    const crawl = await app.inject({
      method: 'POST',
      url: `/api/v1/sources/${sources.ca.id}/sync`,
    });
    expect(crawl.statusCode).toBe(202);
    const search = await app.inject({
      method: 'POST',
      url: `/api/v1/sources/${sources.ca.id}/sync`,
      payload: { mode: 'search', query: 'camiseta' },
    });
    expect(search.statusCode).toBe(202);
    const secondSearch = await app.inject({
      method: 'POST',
      url: `/api/v1/sources/${sources.ca.id}/sync`,
      payload: { mode: 'search', query: 'vestido' },
    });
    expect(secondSearch.statusCode).toBe(409);
  });

  it('fila indisponível -> 502 e CrawlJob marcado como FAILED', async () => {
    queue.fail = true;
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/sources/${sources.ca.id}/sync`,
    });
    expect(response.statusCode).toBe(502);
    const job = await prisma.crawlJob.findFirstOrThrow({ where: { sourceId: sources.ca.id } });
    expect(job.status).toBe('FAILED');
  });
});
