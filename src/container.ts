import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { env } from './config/env.js';
import {
  RedisCacheService,
  type CacheLogger,
  type CacheService,
} from './infrastructure/redis/cache.service.js';
import { CategoryController } from './modules/categories/category.controller.js';
import { CategoryRepository } from './modules/categories/category.repository.js';
import { CategoryService } from './modules/categories/category.service.js';
import { CrawlJobController } from './modules/crawl-jobs/crawl-job.controller.js';
import { CrawlJobRepository } from './modules/crawl-jobs/crawl-job.repository.js';
import type { CrawlQueue } from './modules/crawl-jobs/crawl-job.types.js';
import { LiveSearchController } from './modules/live-search/live-search.controller.js';
import {
  LiveSearchService,
  type LiveSearchProviders,
} from './modules/live-search/live-search.service.js';
import { ProductController } from './modules/products/product.controller.js';
import { ProductRepository } from './modules/products/product.repository.js';
import { ProductService } from './modules/products/product.service.js';
import { SourceController } from './modules/sources/source.controller.js';
import { SourceRepository } from './modules/sources/source.repository.js';
import { SourceService } from './modules/sources/source.service.js';

export interface ContainerDeps {
  prisma: PrismaClient;
  redis: Redis;
  queue: CrawlQueue;
  hasCrawler: (slug: string) => boolean;
  logger?: CacheLogger;
  /** Providers com busca ao vivo (o CrawlerRegistry). Ausente: nenhum provider disponível. */
  liveSearchProviders?: LiveSearchProviders;
  /** Substitui o cache Redis (testes). */
  cache?: CacheService;
}

const noLiveSearchProviders: LiveSearchProviders = { get: () => undefined };

/** Composition root: instancia repositories, services e controllers (injeção manual). */
export function createContainer(deps: ContainerDeps) {
  const cache = deps.cache ?? new RedisCacheService(deps.redis, deps.logger);

  const categoryRepository = new CategoryRepository(deps.prisma);
  const productRepository = new ProductRepository(deps.prisma);
  const sourceRepository = new SourceRepository(deps.prisma);
  const crawlJobRepository = new CrawlJobRepository(deps.prisma);

  const categoryService = new CategoryService(categoryRepository, cache);
  const productService = new ProductService(productRepository, categoryService, cache);
  const sourceService = new SourceService({
    repository: sourceRepository,
    crawlJobs: crawlJobRepository,
    queue: deps.queue,
    hasCrawler: deps.hasCrawler,
  });

  const liveSearchService = new LiveSearchService(
    deps.liveSearchProviders ?? noLiveSearchProviders,
    cache,
    env.GOOGLE_SHOPPING_CACHE_TTL,
  );

  return {
    cache,
    repositories: {
      categories: categoryRepository,
      products: productRepository,
      sources: sourceRepository,
      crawlJobs: crawlJobRepository,
    },
    services: {
      categories: categoryService,
      products: productService,
      sources: sourceService,
      liveSearch: liveSearchService,
    },
    controllers: {
      categories: new CategoryController(categoryService),
      products: new ProductController(productService),
      sources: new SourceController(sourceService),
      crawlJobs: new CrawlJobController(crawlJobRepository),
      liveSearch: new LiveSearchController(liveSearchService),
    },
  };
}

export type Container = ReturnType<typeof createContainer>;
