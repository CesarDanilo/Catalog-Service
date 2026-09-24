import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase, prisma } from './infrastructure/database/prisma.js';
import { createQueueConnection } from './infrastructure/queue/bullmq.js';
import { BullCrawlerQueue } from './infrastructure/queue/queues/crawler.queue.js';
import { createCrawlerWorker } from './infrastructure/queue/workers/crawler.worker.js';
import { connectRedis, disconnectRedis, redis } from './infrastructure/redis/redis.js';
import { LockService } from './infrastructure/redis/lock.service.js';
import { createContainer } from './container.js';
import { syncSchedules } from './jobs/scheduler.js';
import { CrawlRunner } from './modules/crawlers/crawl.runner.js';
import { createCrawlerRegistry } from './modules/crawlers/crawler.factory.js';
import { createCrawlerContext } from './modules/crawlers/shared/crawler-context.js';
import { createLogger } from './shared/utils/logger.js';
import { registerShutdown } from './shared/utils/shutdown.js';

const SCHEDULE_REFRESH_MS = 5 * 60_000;

async function main() {
  const logger = createLogger('catalog-worker');
  await connectDatabase();
  await connectRedis();

  const registry = createCrawlerRegistry(createCrawlerContext());
  const queueConnection = createQueueConnection();
  const workerConnection = createQueueConnection();
  const queue = new BullCrawlerQueue(queueConnection);

  const container = createContainer({
    prisma,
    redis,
    queue,
    hasCrawler: (slug) => registry.has(slug),
    logger,
  });
  const { repositories, services } = container;

  const runner = new CrawlRunner({
    crawlJobs: repositories.crawlJobs,
    sources: repositories.sources,
    products: services.products,
    categories: services.categories,
    registry,
    locks: new LockService(redis),
    logger,
  });

  const worker = createCrawlerWorker({
    connection: workerConnection,
    runner,
    crawlJobs: repositories.crawlJobs,
    logger,
  });

  let scheduleTimer: NodeJS.Timeout | undefined;
  if (env.SCHEDULER_ENABLED) {
    const refresh = () =>
      syncSchedules(queue, repositories.sources, logger).catch((error: unknown) =>
        logger.error({ err: error }, 'failed to sync schedules'),
      );
    await refresh();
    // Reaplica periodicamente para refletir alterações feitas via PATCH /sources/:id.
    scheduleTimer = setInterval(() => void refresh(), SCHEDULE_REFRESH_MS);
  }

  registerShutdown(logger, [
    // Aguarda os jobs em andamento terminarem e para de pegar novos.
    ['worker', () => worker.close()],
    ['scheduler', async () => clearInterval(scheduleTimer)],
    ['crawlers', () => registry.closeAll()],
    ['queue', () => queue.close()],
    [
      'queue connections',
      async () => void (await Promise.all([queueConnection.quit(), workerConnection.quit()])),
    ],
    ['redis', disconnectRedis],
    ['database', disconnectDatabase],
  ]);

  logger.info(
    {
      crawlers: registry.list(),
      concurrency: env.CRAWLER_CONCURRENCY,
      scheduler: env.SCHEDULER_ENABLED,
    },
    'worker started',
  );
}

main().catch((error: unknown) => {
  console.error('Failed to start worker', error);
  process.exit(1);
});
