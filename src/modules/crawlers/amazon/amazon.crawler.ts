import { CrawlerError } from '../../../shared/errors/app-error.js';
import type { Crawler } from '../crawler.interface.js';
import { DEFAULT_CRAWL_LIMIT, type CrawlItem, type CrawlOptions } from '../crawler.types.js';
import { mapAmazonItem } from './amazon.mapper.js';
import { parseAmazonCatalogItem } from './amazon.parser.js';

/**
 * Fonte autorizada de dados da Amazon (API oficial, afiliados, feed...).
 * Retorna itens brutos que serão validados como AmazonCatalogItem.
 */
export interface AmazonCatalogProvider {
  search(query: string, limit: number): AsyncIterable<unknown>;
  browse(limit: number, config: Record<string, unknown>): AsyncIterable<unknown>;
}

/**
 * Provedor padrão: nenhuma integração configurada.
 * Os Termos de Uso da Amazon não permitem scraping, então este projeto não o implementa.
 */
export class UnconfiguredAmazonProvider implements AmazonCatalogProvider {
  search(): AsyncIterable<unknown> {
    return this.fail();
  }

  browse(): AsyncIterable<unknown> {
    return this.fail();
  }

  private fail(): AsyncIterable<unknown> {
    throw new CrawlerError(
      'Amazon integration is not configured. Scraping amazon.com.br is not supported; ' +
        'implement an AmazonCatalogProvider backed by an authorized API or feed.',
      false,
    );
  }
}

export class AmazonCrawler implements Crawler {
  readonly source = 'amazon';

  constructor(
    private readonly provider: AmazonCatalogProvider = new UnconfiguredAmazonProvider(),
  ) {}

  search(query: string, options: CrawlOptions = {}): AsyncIterable<CrawlItem> {
    return this.toItems(this.provider.search(query, options.limit ?? DEFAULT_CRAWL_LIMIT));
  }

  crawl(options: CrawlOptions = {}): AsyncIterable<CrawlItem> {
    return this.toItems(
      this.provider.browse(options.limit ?? DEFAULT_CRAWL_LIMIT, options.config ?? {}),
    );
  }

  private async *toItems(raw: AsyncIterable<unknown>): AsyncIterable<CrawlItem> {
    for await (const entry of raw) {
      const parsed = parseAmazonCatalogItem(entry);
      if (parsed.success) {
        yield { ok: true, product: mapAmazonItem(parsed.data) };
      } else {
        const reference = (entry as { asin?: string } | null)?.asin ?? 'unknown';
        yield { ok: false, reference, error: parsed.error.issues.map((i) => i.message).join('; ') };
      }
    }
  }
}
