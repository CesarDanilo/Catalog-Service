import type { LockService } from '../../infrastructure/redis/lock.service.js';
import { CrawlerError } from '../../shared/errors/app-error.js';
import type { CategoryService } from '../categories/category.service.js';
import type { CrawlJobRepository } from '../crawl-jobs/crawl-job.repository.js';
import type { CrawlJobParams, CrawlStats } from '../crawl-jobs/crawl-job.types.js';
import type { ProductService } from '../products/product.service.js';
import type { SourceRecord, SourceRepository } from '../sources/source.repository.js';
import type { CrawlerRegistry } from './crawler.registry.js';
import { DEFAULT_CRAWL_LIMIT, type CrawlItem, type CrawlOptions } from './crawler.types.js';
import { normalizeProduct } from './normalizer/product.normalizer.js';

export interface RunnerLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface CrawlRunnerDeps {
  crawlJobs: CrawlJobRepository;
  sources: SourceRepository;
  products: ProductService;
  categories: CategoryService;
  registry: CrawlerRegistry;
  locks: LockService;
  logger: RunnerLogger;
}

/** Erro que não deve ser repetido pela fila (a execução falharia do mesmo jeito). */
export class NonRetryableCrawlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableCrawlError';
  }
}

const LOCK_TTL_MS = 60 * 60 * 1000;
const PROGRESS_EVERY = 25;

/**
 * Executa um CrawlJob de ponta a ponta:
 * crawler -> normalização -> upsert (sourceId + externalId) -> métricas no CrawlJob.
 * Falhas de produtos individuais incrementam `productsFailed` e não interrompem o crawl.
 */
export class CrawlRunner {
  constructor(private readonly deps: CrawlRunnerDeps) {}

  async run(crawlJobId: string): Promise<CrawlStats> {
    const { crawlJobs, sources, registry, locks, logger } = this.deps;

    const job = await crawlJobs.findById(crawlJobId);
    if (!job) throw new NonRetryableCrawlError(`CrawlJob ${crawlJobId} not found`);

    const source = await sources.findById(job.sourceId);
    if (!source) return this.abort(crawlJobId, `Source ${job.sourceId} not found`);
    if (!source.enabled) return this.abort(crawlJobId, `Source "${source.slug}" is disabled`);

    const crawler = registry.get(source.slug);
    if (!crawler) return this.abort(crawlJobId, `No crawler registered for "${source.slug}"`);

    const lock = await locks.acquire(`catalog:lock:crawl:${source.id}`, LOCK_TTL_MS);
    if (!lock) {
      return this.abort(crawlJobId, `Another crawl is already running for "${source.slug}"`);
    }

    const log = { crawlJobId, source: source.slug };
    const stats: CrawlStats = {
      productsFound: 0,
      productsCreated: 0,
      productsUpdated: 0,
      productsFailed: 0,
    };
    const startedAt = Date.now();

    try {
      await crawlJobs.markRunning(crawlJobId);
      logger.info({ ...log, params: job.params }, 'crawl started');

      const params: CrawlJobParams = job.params ?? { mode: 'crawl' };
      const options: CrawlOptions = {
        limit: params.limit ?? source.maxPages ?? DEFAULT_CRAWL_LIMIT,
        config: (source.config as Record<string, unknown> | null) ?? {},
      };
      const items =
        params.mode === 'search' && params.query
          ? crawler.search(params.query, options)
          : crawler.crawl(options);

      await this.consume(items, source, stats, crawlJobId);

      await crawlJobs.markCompleted(crawlJobId, stats);
      await sources.markSynced(source.id, new Date());
      logger.info({ ...log, ...stats, durationMs: Date.now() - startedAt }, 'crawl completed');
      if (stats.productsFound === 0) {
        logger.warn(log, 'crawl found no products — the source structure may have changed');
      }
      return stats;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await crawlJobs.markFailed(crawlJobId, message, stats);
      logger.error(
        { ...log, ...stats, err: error, durationMs: Date.now() - startedAt },
        'crawl failed',
      );
      if (error instanceof CrawlerError && !error.retryable)
        throw new NonRetryableCrawlError(message);
      throw error;
    } finally {
      await lock.release();
    }
  }

  private async consume(
    items: AsyncIterable<CrawlItem>,
    source: SourceRecord,
    stats: CrawlStats,
    crawlJobId: string,
  ): Promise<void> {
    const { products, categories, crawlJobs, logger } = this.deps;
    const categoryIds = await categories.getSlugToIdMap();
    const scrapedAt = new Date();

    for await (const item of items) {
      stats.productsFound++;

      if (!item.ok) {
        stats.productsFailed++;
        logger.warn(
          { crawlJobId, source: source.slug, product: item.reference, error: item.error },
          'product scrape failed',
        );
      } else {
        try {
          const normalized = normalizeProduct(item.product);
          const categoryId = normalized.categorySlug
            ? (categoryIds.get(normalized.categorySlug) ?? null)
            : null;
          const result = await products.saveScraped(source.id, normalized, categoryId, scrapedAt);
          if (result.created) stats.productsCreated++;
          else stats.productsUpdated++;
        } catch (error) {
          stats.productsFailed++;
          logger.warn(
            { crawlJobId, source: source.slug, product: item.product.externalId, err: error },
            'product processing failed',
          );
        }
      }

      if (stats.productsFound % PROGRESS_EVERY === 0) {
        await crawlJobs.updateProgress(crawlJobId, stats);
      }
    }
  }

  private async abort(crawlJobId: string, reason: string): Promise<never> {
    await this.deps.crawlJobs.markFailed(crawlJobId, reason);
    this.deps.logger.warn({ crawlJobId, reason }, 'crawl aborted');
    throw new NonRetryableCrawlError(reason);
  }
}
