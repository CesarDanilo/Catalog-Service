import type { CrawlJobStatus } from '@prisma/client';

export type CrawlMode = 'crawl' | 'search';

export interface CrawlJobParams {
  mode: CrawlMode;
  query?: string;
  limit?: number;
}

export interface CrawlStats {
  productsFound: number;
  productsCreated: number;
  productsUpdated: number;
  productsFailed: number;
}

export interface CrawlJobDto extends CrawlStats {
  id: string;
  sourceId: string;
  status: CrawlJobStatus;
  params: CrawlJobParams | null;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Port da fila de crawl. O domínio só conhece esta interface;
 * a implementação com BullMQ fica em infrastructure/queue.
 */
export interface CrawlQueue {
  enqueueCrawl(data: { crawlJobId: string; sourceId: string }): Promise<void>;
}
