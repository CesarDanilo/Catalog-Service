import { UnrecoverableError, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { env } from '../../../config/env.js';
import type { CrawlJobRepository } from '../../../modules/crawl-jobs/crawl-job.repository.js';
import {
  NonRetryableCrawlError,
  type CrawlRunner,
} from '../../../modules/crawlers/crawl.runner.js';
import type { Logger } from '../../../shared/utils/logger.js';
import {
  CRAWLER_QUEUE_NAME,
  CrawlerJobName,
  type CrawlSourceJobData,
  type SyncSourceJobData,
} from '../bullmq.js';

export interface CrawlerWorkerDeps {
  connection: Redis;
  runner: CrawlRunner;
  crawlJobs: CrawlJobRepository;
  logger: Logger;
}

/**
 * Worker da fila `crawler`.
 * - crawl-source: executa um CrawlJob criado pela API;
 * - sync-source: disparado pelo scheduler; cria o CrawlJob e executa.
 * Erros não-retentáveis viram UnrecoverableError (BullMQ não tenta de novo);
 * os demais são repetidos com backoff exponencial.
 */
export function createCrawlerWorker({ connection, runner, crawlJobs, logger }: CrawlerWorkerDeps) {
  const process = async (job: Job) => {
    const log = { jobId: job.id, jobName: job.name, attempt: job.attemptsMade + 1 };
    logger.info(log, 'job received');

    try {
      if (job.name === CrawlerJobName.CrawlSource) {
        const { crawlJobId } = job.data as CrawlSourceJobData;
        return await runner.run(crawlJobId);
      }

      if (job.name === CrawlerJobName.SyncSource) {
        const { sourceId } = job.data as SyncSourceJobData;
        if (await crawlJobs.findActiveBySource(sourceId)) {
          logger.info({ ...log, sourceId }, 'scheduled sync skipped: crawl already active');
          return null;
        }
        const crawlJob = await crawlJobs.create(sourceId, { mode: 'crawl' });
        return await runner.run(crawlJob.id);
      }

      throw new UnrecoverableError(`Unknown job name "${job.name}"`);
    } catch (error) {
      if (error instanceof NonRetryableCrawlError) throw new UnrecoverableError(error.message);
      throw error;
    }
  };

  const worker = new Worker(CRAWLER_QUEUE_NAME, process, {
    connection,
    concurrency: env.CRAWLER_CONCURRENCY,
    // Crawls longos: o lock do job é renovado automaticamente enquanto o worker está vivo.
    lockDuration: 5 * 60_000,
  });

  worker.on('completed', (job, result) => {
    logger.info({ jobId: job.id, jobName: job.name, result }, 'job completed');
  });
  worker.on('failed', (job, error) => {
    logger.error(
      { jobId: job?.id, jobName: job?.name, attemptsMade: job?.attemptsMade, err: error },
      'job failed',
    );
  });
  worker.on('error', (error) => logger.error({ err: error }, 'worker error'));

  return worker;
}
