import type { CrawlJob, Prisma, PrismaClient } from '@prisma/client';
import { toOffset, type PaginationParams } from '../../shared/utils/pagination.js';
import type { CrawlJobDto, CrawlJobParams, CrawlStats } from './crawl-job.types.js';

/** Um job sem progresso há mais tempo que isso é considerado abandonado (worker caiu). */
export const STALE_JOB_MS = 30 * 60 * 1000;

export class CrawlJobRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(sourceId: string, params: CrawlJobParams): Promise<CrawlJobDto> {
    const job = await this.prisma.crawlJob.create({
      data: { sourceId, params: params as unknown as Prisma.InputJsonValue },
    });
    return toDto(job);
  }

  async findById(id: string): Promise<CrawlJobDto | null> {
    const job = await this.prisma.crawlJob.findUnique({ where: { id } });
    return job ? toDto(job) : null;
  }

  async findActiveBySource(sourceId: string): Promise<CrawlJobDto | null> {
    const job = await this.prisma.crawlJob.findFirst({
      where: {
        sourceId,
        status: { in: ['PENDING', 'RUNNING'] },
        updatedAt: { gt: new Date(Date.now() - STALE_JOB_MS) },
      },
      orderBy: { createdAt: 'desc' },
    });
    return job ? toDto(job) : null;
  }

  async listBySource(
    sourceId: string,
    pagination: PaginationParams,
  ): Promise<{ items: CrawlJobDto[]; total: number }> {
    const where = { sourceId };
    const [jobs, total] = await Promise.all([
      this.prisma.crawlJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...toOffset(pagination),
      }),
      this.prisma.crawlJob.count({ where }),
    ]);
    return { items: jobs.map(toDto), total };
  }

  async markRunning(id: string): Promise<void> {
    await this.prisma.crawlJob.update({
      where: { id },
      data: {
        status: 'RUNNING',
        startedAt: new Date(),
        finishedAt: null,
        errorMessage: null,
        productsFound: 0,
        productsCreated: 0,
        productsUpdated: 0,
        productsFailed: 0,
      },
    });
  }

  async updateProgress(id: string, stats: CrawlStats): Promise<void> {
    await this.prisma.crawlJob.update({ where: { id }, data: stats });
  }

  async markCompleted(id: string, stats: CrawlStats): Promise<void> {
    await this.prisma.crawlJob.update({
      where: { id },
      data: { ...stats, status: 'COMPLETED', finishedAt: new Date() },
    });
  }

  async markFailed(id: string, errorMessage: string, stats?: CrawlStats): Promise<void> {
    await this.prisma.crawlJob.update({
      where: { id },
      data: {
        ...stats,
        status: 'FAILED',
        finishedAt: new Date(),
        errorMessage: errorMessage.slice(0, 2_000),
      },
    });
  }
}

function toDto(job: CrawlJob): CrawlJobDto {
  return {
    id: job.id,
    sourceId: job.sourceId,
    status: job.status,
    params: job.params as CrawlJobParams | null,
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    productsFound: job.productsFound,
    productsCreated: job.productsCreated,
    productsUpdated: job.productsUpdated,
    productsFailed: job.productsFailed,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}
