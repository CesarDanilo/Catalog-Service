import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { createContainer } from '../../src/container.js';
import { prisma } from '../../src/infrastructure/database/prisma.js';
import type { CacheService } from '../../src/infrastructure/redis/cache.service.js';
import { redis } from '../../src/infrastructure/redis/redis.js';
import { CrawlerRegistry } from '../../src/modules/crawlers/crawler.registry.js';
import {
  parseGoogleShoppingHtml,
  type GoogleShoppingHtmlPayload,
} from '../../src/modules/crawlers/google-shopping/google-shopping.html-parser.js';
import { GoogleShoppingProvider } from '../../src/modules/crawlers/google-shopping/google-shopping.provider.js';
import type {
  GoogleShoppingFetcher,
  GoogleShoppingRequest,
} from '../../src/modules/crawlers/google-shopping/google-shopping.types.js';
import { FakeQueue } from './app.js';
import { readFixture } from './fixtures.js';

/** Cache em memória com a mesma semântica do RedisCacheService (sem Redis). */
export class MemoryCache implements CacheService {
  readonly store = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | null> {
    return (this.store.get(key) as T | undefined) ?? null;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.store.set(key, value);
  }

  async del(...keys: string[]): Promise<void> {
    keys.forEach((key) => this.store.delete(key));
  }

  async getOrSet<T>(key: string, _ttl: number, loader: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;
    const value = await loader();
    if (value !== null && value !== undefined) await this.set(key, value);
    return value;
  }
}

/**
 * "Scraper" falso: devolve a fixture em `next` (sem internet), conta chamadas e simula
 * páginas abertas/fechadas pra detectar vazamento de recursos.
 */
export class FixtureFetcher implements GoogleShoppingFetcher<GoogleShoppingHtmlPayload> {
  readonly name = 'fixture';
  calls = 0;
  openPages = 0;
  peakOpenPages = 0;
  next = 'search-success.html';
  delayMs = 0;
  readonly queries: string[] = [];

  async fetch(request: GoogleShoppingRequest) {
    this.calls++;
    this.queries.push(request.query);
    this.openPages++;
    this.peakOpenPages = Math.max(this.peakOpenPages, this.openPages);
    try {
      if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      const html = readFixture(`google-shopping/${this.next}`);
      return { payload: { html, baseUrl: 'https://www.google.com.br' }, timings: {} };
    } finally {
      this.openPages--;
    }
  }
}

export interface GoogleShoppingTestAppOptions {
  maxConcurrency?: number;
  maxQueue?: number;
  rateLimitAllowList?: string;
}

/**
 * App completo (rotas, validação, erros) com o Google Shopping real (provider, parser, mapper)
 * sobre o FixtureFetcher, e cache em memória — não precisa de internet, Redis nem Postgres.
 */
export async function buildGoogleShoppingTestApp(options: GoogleShoppingTestAppOptions = {}) {
  const fetcher = new FixtureFetcher();
  const cache = new MemoryCache();
  const registry = new CrawlerRegistry().register(
    new GoogleShoppingProvider({
      fetcher,
      parse: parseGoogleShoppingHtml,
      config: {
        defaultMarket: { country: 'BR', language: 'pt-BR', domain: 'google.com.br' },
        defaultCurrency: 'BRL',
        maxConcurrency: options.maxConcurrency ?? 1,
        maxQueue: options.maxQueue ?? 5,
        requestDelayMs: 0,
        timeoutMs: 5_000,
        maxAttempts: 2,
        maxProducts: 60,
      },
    }),
  );
  const container = createContainer({
    prisma,
    redis,
    queue: new FakeQueue(),
    hasCrawler: (slug) => registry.has(slug),
    liveSearchProviders: registry,
    cache,
  });
  const app: FastifyInstance = await buildApp({
    container,
    health: { database: async () => undefined, redis: async () => undefined },
    logger: false,
    rateLimitAllowList: options.rateLimitAllowList,
  });
  await app.ready();
  return { app, fetcher, cache };
}
