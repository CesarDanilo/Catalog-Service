import {
  ConflictError,
  ExternalServiceError,
  NotFoundError,
} from '../../shared/errors/app-error.js';
import {
  buildPaginationMeta,
  type Paginated,
  type PaginationParams,
} from '../../shared/utils/pagination.js';
import type { CrawlJobRepository } from '../crawl-jobs/crawl-job.repository.js';
import type { CrawlJobDto, CrawlQueue } from '../crawl-jobs/crawl-job.types.js';
import type { SourceRecord, SourceRepository } from './source.repository.js';
import type { SyncSourceBody, UpdateSourceBody } from './source.schema.js';

export interface SourceDto {
  id: string;
  name: string;
  slug: string;
  baseUrl: string;
  enabled: boolean;
  crawlInterval: number | null;
  maxPages: number | null;
  config: Record<string, unknown> | null;
  lastSyncAt: string | null;
  productsCount: number;
  crawlerAvailable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SourceServiceDeps {
  repository: SourceRepository;
  crawlJobs: CrawlJobRepository;
  queue: CrawlQueue;
  /** Indica se existe crawler registrado para o slug (vem do CrawlerRegistry). */
  hasCrawler: (slug: string) => boolean;
}

export class SourceService {
  constructor(private readonly deps: SourceServiceDeps) {}

  async list(): Promise<SourceDto[]> {
    const sources = await this.deps.repository.findAll();
    return sources.map((source) => this.toDto(source));
  }

  async getById(id: string): Promise<SourceDto> {
    return this.toDto(await this.findOrFail(id));
  }

  async update(id: string, body: UpdateSourceBody): Promise<SourceDto> {
    await this.findOrFail(id);
    return this.toDto(await this.deps.repository.update(id, body));
  }

  /** Cria um CrawlJob e o envia para a fila. O crawl roda no worker, não na requisição. */
  async requestSync(id: string, body: SyncSourceBody): Promise<CrawlJobDto> {
    const source = await this.findOrFail(id);

    if (!source.enabled) {
      throw new ConflictError('SOURCE_DISABLED', `Source "${source.slug}" is disabled`);
    }
    if (!this.deps.hasCrawler(source.slug)) {
      throw new ConflictError(
        'CRAWLER_NOT_AVAILABLE',
        `No crawler registered for source "${source.slug}"`,
      );
    }
    const active = await this.deps.crawlJobs.findActiveBySource(source.id);
    if (active) {
      throw new ConflictError(
        'CRAWL_ALREADY_RUNNING',
        `Crawl job ${active.id} is already ${active.status.toLowerCase()} for this source`,
      );
    }

    const job = await this.deps.crawlJobs.create(source.id, {
      mode: body.mode,
      ...(body.query && { query: body.query }),
      ...(body.limit && { limit: body.limit }),
    });

    try {
      await this.deps.queue.enqueueCrawl({ crawlJobId: job.id, sourceId: source.id });
    } catch (error) {
      await this.deps.crawlJobs.markFailed(job.id, 'Failed to enqueue crawl job');
      throw new ExternalServiceError('Queue unavailable', {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    return job;
  }

  async listJobs(id: string, pagination: PaginationParams): Promise<Paginated<CrawlJobDto>> {
    await this.findOrFail(id);
    const { items, total } = await this.deps.crawlJobs.listBySource(id, pagination);
    return { data: items, pagination: buildPaginationMeta(pagination, total) };
  }

  private async findOrFail(id: string): Promise<SourceRecord> {
    const source = await this.deps.repository.findById(id);
    if (!source) throw new NotFoundError('SOURCE_NOT_FOUND', 'Source not found');
    return source;
  }

  private toDto(source: SourceRecord): SourceDto {
    const { _count, config, lastSyncAt, createdAt, updatedAt, ...rest } = source;
    return {
      ...rest,
      config: (config as Record<string, unknown> | null) ?? null,
      lastSyncAt: lastSyncAt?.toISOString() ?? null,
      productsCount: _count.products,
      crawlerAvailable: this.deps.hasCrawler(source.slug),
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
    };
  }
}
