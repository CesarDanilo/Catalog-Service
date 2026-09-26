import { describe, expect, it } from 'vitest';
import {
  AmazonCrawler,
  type AmazonCatalogProvider,
} from '../../src/modules/crawlers/amazon/amazon.crawler.js';
import type { Crawler } from '../../src/modules/crawlers/crawler.interface.js';
import { parseSourceList } from '../../src/config/env.js';
import { createCrawlerRegistry } from '../../src/modules/crawlers/crawler.factory.js';
import { CrawlerRegistry } from '../../src/modules/crawlers/crawler.registry.js';
import type { CrawlerContext } from '../../src/modules/crawlers/shared/crawler-context.js';
import { syncSchedules } from '../../src/jobs/scheduler.js';
import type { CrawlItem } from '../../src/modules/crawlers/crawler.types.js';
import { CrawlerError } from '../../src/shared/errors/app-error.js';

async function collect(items: AsyncIterable<CrawlItem>) {
  const result: CrawlItem[] = [];
  for await (const item of items) result.push(item);
  return result;
}

describe('CrawlerRegistry', () => {
  const fake = (source: string): Crawler => ({
    source,
    search: async function* () {},
    crawl: async function* () {},
  });

  it('registra e localiza crawlers pelo slug', () => {
    const registry = new CrawlerRegistry().register(fake('renner')).register(fake('ca'));
    expect(registry.get('renner')?.source).toBe('renner');
    expect(registry.has('amazon')).toBe(false);
    expect(registry.list()).toEqual(['renner', 'ca']);
  });

  it('CRAWLER_DISABLED_SOURCES tira a loja do registro', () => {
    const context = {
      createHttpClient: () => ({}),
      browser: {},
      userAgent: 'test',
      timeoutMs: 1_000,
    } as unknown as CrawlerContext;
    expect(createCrawlerRegistry(context, new Set()).list().sort()).toEqual([
      'amazon',
      'ca',
      'renner',
    ]);
    const registry = createCrawlerRegistry(context, parseSourceList(' Amazon , ca,'));
    expect(registry.list()).toEqual(['renner']);
    expect(registry.has('ca')).toBe(false);
  });

  it('agendador não agenda loja sem crawler (desligada) e remove o agendamento antigo', async () => {
    const scheduled: string[] = [];
    const removed: string[] = [];
    const queue = {
      scheduleSync: async (slug: string) => void scheduled.push(slug),
      listSchedulerIds: async () => ['sync:renner', 'sync:ca'],
      removeScheduler: async (id: string) => void removed.push(id),
    };
    const sources = {
      findScheduled: async () => [
        { id: '1', slug: 'renner', crawlInterval: 360 },
        { id: '2', slug: 'ca', crawlInterval: 360 },
      ],
    };
    const logger = { info: () => {} };
    await syncSchedules(queue as never, sources as never, logger as never, (slug) => slug !== 'ca');
    expect(scheduled).toEqual(['renner']);
    expect(removed).toEqual(['sync:ca']);
  });

  it('impede registro duplicado', () => {
    const registry = new CrawlerRegistry().register(fake('renner'));
    expect(() => registry.register(fake('renner'))).toThrow(/already registered/);
  });
});

describe('AmazonCrawler', () => {
  it('sem provedor autorizado falha com erro não-retentável', () => {
    const crawler = new AmazonCrawler();
    try {
      crawler.crawl();
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CrawlerError);
      expect((error as CrawlerError).retryable).toBe(false);
    }
  });

  it('com provedor, valida e mapeia itens', async () => {
    const provider: AmazonCatalogProvider = {
      search: async function* () {
        yield {
          asin: 'B000TEST',
          title: 'Camiseta Masculina Preta',
          price: 59.9,
          detailPageUrl: 'https://www.amazon.com.br/dp/B000TEST',
          imageUrls: ['https://m.media-amazon.com/images/I/test.jpg'],
        };
        yield { asin: 'BROKEN' };
      },
      browse: async function* () {},
    };
    const items = await collect(new AmazonCrawler(provider).search('camiseta'));
    expect(items[0]).toMatchObject({ ok: true, product: { externalId: 'B000TEST', price: 59.9 } });
    expect(items[1]).toMatchObject({ ok: false, reference: 'BROKEN' });
  });
});
