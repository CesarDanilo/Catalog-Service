import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { createContainer } from '../../src/container.js';
import { pingDatabase, prisma } from '../../src/infrastructure/database/prisma.js';
import { pingRedis, redis } from '../../src/infrastructure/redis/redis.js';
import type { CrawlQueue } from '../../src/modules/crawl-jobs/crawl-job.types.js';

export class FakeQueue implements CrawlQueue {
  readonly jobs: Array<{ crawlJobId: string; sourceId: string }> = [];
  fail = false;

  async enqueueCrawl(data: { crawlJobId: string; sourceId: string }): Promise<void> {
    if (this.fail) throw new Error('redis down');
    this.jobs.push(data);
  }
}

export async function buildTestApp(queue: CrawlQueue = new FakeQueue()) {
  const crawlers = new Set(['renner', 'ca', 'amazon']);
  const container = createContainer({
    prisma,
    redis,
    queue,
    hasCrawler: (slug) => crawlers.has(slug),
  });
  const app: FastifyInstance = await buildApp({
    container,
    health: { database: pingDatabase, redis: pingRedis },
    logger: false,
  });
  await app.ready();
  return { app, container, queue };
}
