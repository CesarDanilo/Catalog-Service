import type { Job, QueueEvents as QueueEventsType, Worker } from 'bullmq';
import { QueueEvents } from 'bullmq';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createContainer, type Container } from '../../src/container.js';
import {
  CRAWLER_QUEUE_NAME,
  createQueueConnection,
} from '../../src/infrastructure/queue/bullmq.js';
import { BullCrawlerQueue } from '../../src/infrastructure/queue/queues/crawler.queue.js';
import { createCrawlerWorker } from '../../src/infrastructure/queue/workers/crawler.worker.js';
import { LockService } from '../../src/infrastructure/redis/lock.service.js';
import { CACrawler } from '../../src/modules/crawlers/ca/ca.crawler.js';
import { CrawlRunner } from '../../src/modules/crawlers/crawl.runner.js';
import { AmazonCrawler } from '../../src/modules/crawlers/amazon/amazon.crawler.js';
import { CrawlerRegistry } from '../../src/modules/crawlers/crawler.registry.js';
import { HttpClient } from '../../src/modules/crawlers/shared/http-client.js';
import { createLogger } from '../../src/shared/utils/logger.js';
import { closeConnections, prisma, redis, resetDatabase, seedBasics } from '../helpers/db.js';
import { fakeFetch, readJsonFixture } from '../helpers/fixtures.js';

const fixture = readJsonFixture<unknown[]>('ca-search.json');
const logger = createLogger('test');

let container: Container;
let runner: CrawlRunner;
let sources: Awaited<ReturnType<typeof seedBasics>>['sources'];

beforeAll(async () => {
  if (redis.status === 'wait') await redis.connect();
  // C&A com a resposta real da API servida localmente (sem internet).
  const http = new HttpClient({
    userAgent: 'test',
    timeoutMs: 1_000,
    maxRetries: 1,
    minDelayMs: 0,
    fetchFn: fakeFetch([[/cea\.com\.br/, () => Response.json(fixture)]]),
  });
  const registry = new CrawlerRegistry()
    .register(new CACrawler(http))
    .register(new AmazonCrawler());
  container = createContainer({
    prisma,
    redis,
    queue: { enqueueCrawl: async () => {} },
    hasCrawler: (s) => registry.has(s),
  });
  runner = new CrawlRunner({
    crawlJobs: container.repositories.crawlJobs,
    sources: container.repositories.sources,
    products: container.services.products,
    categories: container.services.categories,
    registry,
    locks: new LockService(redis),
    logger,
  });
});

beforeEach(async () => {
  await resetDatabase();
  ({ sources } = await seedBasics());
});

afterAll(async () => {
  await closeConnections();
});

describe('crawl flow (runner + Postgres)', () => {
  it('o mesmo produto vindo de categorias diferentes vira um único registro', async () => {
    // O fetch falso devolve o mesmo produto para as duas categorias padrão da C&A.
    const job = await container.repositories.crawlJobs.create(sources.ca.id, {
      mode: 'crawl',
      limit: 2,
    });
    expect(await runner.run(job.id)).toMatchObject({
      productsFound: 2,
      productsCreated: 1,
      productsUpdated: 1,
    });
    expect(await prisma.product.count()).toBe(1);
  });

  it('persiste produtos normalizados e é idempotente entre execuções', async () => {
    const first = await container.repositories.crawlJobs.create(sources.ca.id, {
      mode: 'search',
      query: 'camisa preta',
      limit: 2,
    });
    expect(await runner.run(first.id)).toMatchObject({
      productsFound: 2,
      productsCreated: 2,
      productsUpdated: 0,
    });

    const second = await container.repositories.crawlJobs.create(sources.ca.id, {
      mode: 'search',
      query: 'camisa preta',
      limit: 2,
    });
    expect(await runner.run(second.id)).toMatchObject({
      productsFound: 2,
      productsCreated: 0,
      productsUpdated: 2,
    });

    expect(await prisma.product.count()).toBe(2);
    const product = await prisma.product.findFirstOrThrow({
      where: { externalId: '4558067' },
      include: { category: true, images: true },
    });
    expect(product).toMatchObject({
      gender: 'feminino',
      color: 'preto',
      category: { slug: 'camisas' },
    });
    expect(product.images.length).toBeGreaterThan(0);
    expect(product.rawData).toMatchObject({ productId: '4558067' });

    const job = await prisma.crawlJob.findUniqueOrThrow({ where: { id: second.id } });
    expect(job).toMatchObject({ status: 'COMPLETED', productsFound: 2, productsUpdated: 2 });
    expect(job.startedAt).not.toBeNull();
    expect(job.finishedAt).not.toBeNull();
    expect(
      (await prisma.source.findUniqueOrThrow({ where: { id: sources.ca.id } })).lastSyncAt,
    ).not.toBeNull();
  });

  it('execuções concorrentes não duplicam produtos', async () => {
    const jobs = await Promise.all(
      [1, 2, 3].map(() =>
        container.repositories.crawlJobs.create(sources.ca.id, {
          mode: 'search',
          query: 'camisa',
          limit: 2,
        }),
      ),
    );
    await Promise.allSettled(jobs.map((job) => runner.run(job.id)));
    // Um executa, os demais são barrados pelo lock; em nenhum caso há duplicatas.
    expect(await prisma.product.count()).toBe(2);
  });
});

describe('crawler queue + worker (BullMQ)', () => {
  let queueConnection: Redis;
  let workerConnection: Redis;
  let queue: BullCrawlerQueue;
  let worker: Worker;
  let events: QueueEventsType;

  beforeAll(async () => {
    queueConnection = createQueueConnection();
    workerConnection = createQueueConnection();
    queue = new BullCrawlerQueue(queueConnection);
    await queue.queue.obliterate({ force: true });
    events = new QueueEvents(CRAWLER_QUEUE_NAME, { connection: createQueueConnection() });
    await events.waitUntilReady();
    worker = createCrawlerWorker({
      connection: workerConnection,
      runner,
      crawlJobs: container.repositories.crawlJobs,
      logger,
    });
    await worker.waitUntilReady();
  });

  afterAll(async () => {
    await worker.close();
    await events.close();
    await queue.close();
    await Promise.all([queueConnection.quit(), workerConnection.quit()]);
  });

  async function enqueueAndWait(sourceId: string): Promise<Job> {
    const crawlJob = await container.repositories.crawlJobs.create(sourceId, {
      mode: 'search',
      query: 'camisa',
      limit: 2,
    });
    await queue.enqueueCrawl({ crawlJobId: crawlJob.id, sourceId });
    const job = (await queue.queue.getJob(crawlJob.id))!;
    await job.waitUntilFinished(events, 15_000).catch(() => undefined);
    return (await queue.queue.getJob(crawlJob.id))!;
  }

  it('worker processa crawl-source e conclui o CrawlJob', async () => {
    const job = await enqueueAndWait(sources.ca.id);
    expect(await job.getState()).toBe('completed');
    expect(job.opts.attempts).toBeGreaterThanOrEqual(1);
    expect(job.opts.backoff).toMatchObject({ type: 'exponential' });
    expect(await prisma.crawlJob.findUniqueOrThrow({ where: { id: job.id! } })).toMatchObject({
      status: 'COMPLETED',
      productsCreated: 2,
    });
  });

  it('erro não-retentável (Amazon sem integração) falha sem retry e sem derrubar o worker', async () => {
    await prisma.source.update({ where: { id: sources.amazon.id }, data: { enabled: true } });
    const job = await enqueueAndWait(sources.amazon.id);
    expect(await job.getState()).toBe('failed');
    expect(job.attemptsMade).toBe(1);
    const crawlJob = await prisma.crawlJob.findUniqueOrThrow({ where: { id: job.id! } });
    expect(crawlJob.status).toBe('FAILED');
    expect(crawlJob.errorMessage).toMatch(/Amazon integration is not configured/);

    // O worker continua saudável e processa o próximo job.
    expect(await (await enqueueAndWait(sources.ca.id)).getState()).toBe('completed');
  });
});
