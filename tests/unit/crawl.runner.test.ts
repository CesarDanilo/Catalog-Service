import { describe, expect, it, vi } from 'vitest';
import type { LockService } from '../../src/infrastructure/redis/lock.service.js';
import type { CategoryService } from '../../src/modules/categories/category.service.js';
import type { CrawlJobRepository } from '../../src/modules/crawl-jobs/crawl-job.repository.js';
import { CrawlRunner, NonRetryableCrawlError } from '../../src/modules/crawlers/crawl.runner.js';
import type { Crawler } from '../../src/modules/crawlers/crawler.interface.js';
import { CrawlerRegistry } from '../../src/modules/crawlers/crawler.registry.js';
import type { CrawlItem, ScrapedProduct } from '../../src/modules/crawlers/crawler.types.js';
import type { ProductService } from '../../src/modules/products/product.service.js';
import type { SourceRepository } from '../../src/modules/sources/source.repository.js';
import { CrawlerError } from '../../src/shared/errors/app-error.js';

const product = (id: string, overrides: Partial<ScrapedProduct> = {}): ScrapedProduct => ({
  externalId: id,
  name: `Vestido Feminino ${id}`,
  price: 100,
  currency: 'BRL',
  productUrl: `https://loja.example/p/${id}`,
  available: true,
  ...overrides,
});

function setup(items: CrawlItem[] | (() => AsyncIterable<CrawlItem>), sourceOverrides = {}) {
  const source = {
    id: 's1',
    slug: 'loja',
    enabled: true,
    maxPages: null,
    config: null,
    ...sourceOverrides,
  };
  const crawlJobs = {
    findById: vi.fn(async () => ({ id: 'j1', sourceId: 's1', params: { mode: 'crawl' } })),
    markRunning: vi.fn(async () => {}),
    updateProgress: vi.fn(async () => {}),
    markCompleted: vi.fn(async () => {}),
    markFailed: vi.fn(async () => {}),
  };
  const sources = { findById: vi.fn(async () => source), markSynced: vi.fn(async () => {}) };
  const seen = new Set<string>();
  const products = {
    saveScraped: vi.fn(
      async (_s: string, p: { externalId: string }, _categoryId: string | null) => {
        const created = !seen.has(p.externalId);
        seen.add(p.externalId);
        return { id: p.externalId, created };
      },
    ),
  };
  const categories = { getSlugToIdMap: vi.fn(async () => new Map([['vestidos', 'cat-vestidos']])) };
  const release = vi.fn(async () => {});
  const locks = { acquire: vi.fn(async () => ({ release })) };

  const crawler: Crawler = {
    source: 'loja',
    crawl:
      typeof items === 'function'
        ? items
        : async function* () {
            yield* items;
          },
    search: async function* () {},
  };
  const runner = new CrawlRunner({
    crawlJobs: crawlJobs as unknown as CrawlJobRepository,
    sources: sources as unknown as SourceRepository,
    products: products as unknown as ProductService,
    categories: categories as unknown as CategoryService,
    registry: new CrawlerRegistry().register(crawler),
    locks: locks as unknown as LockService,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
  return { runner, crawlJobs, sources, products, locks, release };
}

describe('CrawlRunner', () => {
  it('normaliza, persiste e contabiliza; falhas não interrompem o crawl', async () => {
    const { runner, crawlJobs, products, sources, release } = setup([
      { ok: true, product: product('1') },
      { ok: false, reference: 'https://loja/p/2', error: 'parse error' },
      { ok: true, product: product('3', { price: 0 }) }, // inválido na normalização
      { ok: true, product: product('1') }, // repetido -> update
    ]);

    const stats = await runner.run('j1');

    expect(stats).toEqual({
      productsFound: 4,
      productsCreated: 1,
      productsUpdated: 1,
      productsFailed: 2,
    });
    expect(crawlJobs.markRunning).toHaveBeenCalledWith('j1');
    expect(crawlJobs.markCompleted).toHaveBeenCalledWith('j1', stats);
    expect(sources.markSynced).toHaveBeenCalled();
    expect(products.saveScraped.mock.calls[0]?.[2]).toBe('cat-vestidos');
    expect(release).toHaveBeenCalled();
  });

  it('não executa fonte desabilitada', async () => {
    const { runner, crawlJobs } = setup([], { enabled: false });
    await expect(runner.run('j1')).rejects.toBeInstanceOf(NonRetryableCrawlError);
    expect(crawlJobs.markFailed).toHaveBeenCalledWith('j1', expect.stringMatching(/disabled/));
    expect(crawlJobs.markRunning).not.toHaveBeenCalled();
  });

  it('não executa em paralelo com outro crawl da mesma fonte (lock)', async () => {
    const { runner, locks, crawlJobs } = setup([]);
    locks.acquire.mockResolvedValueOnce(null as never);
    await expect(runner.run('j1')).rejects.toThrow(/already running/);
    expect(crawlJobs.markRunning).not.toHaveBeenCalled();
  });

  it('marca FAILED com estatísticas parciais e permite retry em erro transitório', async () => {
    const { runner, crawlJobs, release } = setup(async function* () {
      yield { ok: true, product: product('1') } as CrawlItem;
      throw new CrawlerError('timeout');
    });
    const error = await runner.run('j1').catch((e) => e);
    expect(error).toBeInstanceOf(CrawlerError);
    expect(error).not.toBeInstanceOf(NonRetryableCrawlError);
    expect(crawlJobs.markFailed).toHaveBeenCalledWith(
      'j1',
      'timeout',
      expect.objectContaining({ productsFound: 1, productsCreated: 1 }),
    );
    expect(release).toHaveBeenCalled();
  });

  it('erros de crawler não-retentáveis viram NonRetryableCrawlError', async () => {
    const { runner } = setup(async function* () {
      yield* [];
      throw new CrawlerError('blocked', false);
    });
    await expect(runner.run('j1')).rejects.toBeInstanceOf(NonRetryableCrawlError);
  });
});
