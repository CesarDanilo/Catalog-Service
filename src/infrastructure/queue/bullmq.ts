import type { DefaultJobOptions } from 'bullmq';
import { env } from '../../config/env.js';
import { createRedisConnection } from '../redis/redis.js';

export const CRAWLER_QUEUE_NAME = 'crawler';

export const CrawlerJobName = {
  /** Executa um CrawlJob já criado (via POST /sources/:id/sync). */
  CrawlSource: 'crawl-source',
  /** Disparado pelo scheduler: cria o CrawlJob e executa. */
  SyncSource: 'sync-source',
} as const;

export interface CrawlSourceJobData {
  crawlJobId: string;
  sourceId: string;
}

export interface SyncSourceJobData {
  sourceId: string;
}

export const defaultJobOptions: DefaultJobOptions = {
  attempts: env.CRAWLER_MAX_RETRIES,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 7 * 24 * 3600, count: 1_000 },
  removeOnFail: { age: 30 * 24 * 3600 },
};

/** BullMQ exige `maxRetriesPerRequest: null` nas conexões usadas por workers. */
export function createQueueConnection() {
  return createRedisConnection({ maxRetriesPerRequest: null, lazyConnect: false });
}
