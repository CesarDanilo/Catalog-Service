import { env } from './config/env.js';
import { buildApp } from './app.js';
import { createContainer } from './container.js';
import {
  connectDatabase,
  disconnectDatabase,
  pingDatabase,
  prisma,
} from './infrastructure/database/prisma.js';
import { createQueueConnection } from './infrastructure/queue/bullmq.js';
import { BullCrawlerQueue } from './infrastructure/queue/queues/crawler.queue.js';
import { connectRedis, disconnectRedis, pingRedis, redis } from './infrastructure/redis/redis.js';
import { createCrawlerRegistry } from './modules/crawlers/crawler.factory.js';
import { createCrawlerContext } from './modules/crawlers/shared/crawler-context.js';
import { registerShutdown } from './shared/utils/shutdown.js';

async function main() {
  await connectDatabase();
  await connectRedis();

  const queueConnection = createQueueConnection();
  const queue = new BullCrawlerQueue(queueConnection);
  // A API só precisa saber quais fontes têm crawler; nenhum crawler é executado aqui.
  const registry = createCrawlerRegistry(createCrawlerContext());

  const container = createContainer({
    prisma,
    redis,
    queue,
    hasCrawler: (slug) => registry.has(slug),
  });

  const app = await buildApp({
    container,
    health: { database: pingDatabase, redis: pingRedis },
    rateLimitRedis: redis,
  });

  registerShutdown(app.log, [
    ['http server', () => app.close()],
    ['queue', () => queue.close()],
    ['queue connection', async () => void (await queueConnection.quit())],
    ['redis', disconnectRedis],
    ['database', disconnectDatabase],
  ]);

  await app.listen({ port: env.PORT, host: env.HOST });
}

main().catch((error: unknown) => {
  console.error('Failed to start API', error);
  process.exit(1);
});
