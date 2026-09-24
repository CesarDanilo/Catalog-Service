import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { CrawlQueue } from '../../../modules/crawl-jobs/crawl-job.types.js';
import {
  CRAWLER_QUEUE_NAME,
  CrawlerJobName,
  defaultJobOptions,
  type CrawlSourceJobData,
  type SyncSourceJobData,
} from '../bullmq.js';

/** Implementação do port CrawlQueue com BullMQ. Única classe que conhece a fila. */
export class BullCrawlerQueue implements CrawlQueue {
  readonly queue: Queue;

  constructor(connection: Redis) {
    this.queue = new Queue(CRAWLER_QUEUE_NAME, { connection, defaultJobOptions });
  }

  async enqueueCrawl(data: CrawlSourceJobData): Promise<void> {
    // jobId = crawlJobId garante que o mesmo CrawlJob não seja enfileirado duas vezes.
    await this.queue.add(CrawlerJobName.CrawlSource, data, { jobId: data.crawlJobId });
  }

  async scheduleSync(sourceSlug: string, data: SyncSourceJobData, everyMinutes: number) {
    await this.queue.upsertJobScheduler(
      `sync:${sourceSlug}`,
      { every: everyMinutes * 60_000 },
      { name: CrawlerJobName.SyncSource, data },
    );
  }

  async listSchedulerIds(): Promise<string[]> {
    const schedulers = await this.queue.getJobSchedulers();
    return schedulers.map((scheduler) => scheduler.key);
  }

  async removeScheduler(id: string): Promise<void> {
    await this.queue.removeJobScheduler(id);
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
