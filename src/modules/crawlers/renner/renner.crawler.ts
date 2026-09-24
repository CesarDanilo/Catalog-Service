import type { Crawler } from '../crawler.interface.js';
import { DEFAULT_CRAWL_LIMIT, type CrawlItem, type CrawlOptions } from '../crawler.types.js';
import { normalizeCategory } from '../normalizer/product.normalizer.js';
import type { BrowserPool } from '../shared/browser.js';
import { AccessDeniedError, type HttpClient } from '../shared/http-client.js';
import { parseSitemap } from '../shared/sitemap.js';
import { mapRennerProduct } from './renner.mapper.js';
import { extractSlugText, parseProductLinks, parseRennerProductPage } from './renner.parser.js';

export const RENNER_DEFAULT_BASE_URL = 'https://www.lojasrenner.com.br';

export interface RennerCrawlerDeps {
  http: HttpClient;
  browser: BrowserPool;
  userAgent: string;
  timeoutMs: number;
  baseUrl?: string;
}

/**
 * Renner.
 * - crawl(): percorre o sitemap público de produtos (permitido pelo robots.txt) e visita
 *   apenas URLs cujo slug indica vestuário; cada página é lida via HTTP + Cheerio.
 * - search(): a página de busca (/b?Ntt=) é renderizada no cliente, então usa Playwright
 *   apenas para coletar os links; os produtos em si continuam sendo lidos via HTTP.
 */
export class RennerCrawler implements Crawler {
  readonly source = 'renner';
  private readonly baseUrl: string;

  constructor(private readonly deps: RennerCrawlerDeps) {
    this.baseUrl = deps.baseUrl ?? RENNER_DEFAULT_BASE_URL;
  }

  async *search(query: string, options: CrawlOptions = {}): AsyncIterable<CrawlItem> {
    const url = `${this.baseUrl}/b?Ntt=${encodeURIComponent(query.trim())}`;
    const html = await this.deps.browser.renderHtml(url, {
      userAgent: this.deps.userAgent,
      timeoutMs: this.deps.timeoutMs,
      waitForSelector: 'a[href*="/p/"]',
    });
    const links = parseProductLinks(html, this.baseUrl).slice(
      0,
      options.limit ?? DEFAULT_CRAWL_LIMIT,
    );
    yield* this.fetchProducts(links);
  }

  /**
   * Source.config.categories (opcional) restringe os slugs de categoria aceitos,
   * ex.: ["vestidos", "camisas"]. Sem configuração, aceita qualquer item de vestuário/calçado.
   */
  async *crawl(options: CrawlOptions = {}): AsyncIterable<CrawlItem> {
    const limit = options.limit ?? DEFAULT_CRAWL_LIMIT;
    const configured = options.config?.categories;
    const allowed = Array.isArray(configured) ? new Set(configured.map(String)) : null;
    const links: string[] = [];

    for await (const url of this.productUrlsFromSitemap()) {
      const category = normalizeCategory(extractSlugText(url));
      if (category && (!allowed || allowed.has(category))) links.push(url);
      if (links.length >= limit) break;
    }
    yield* this.fetchProducts(links);
  }

  async close(): Promise<void> {
    await this.deps.browser.close();
  }

  private async *productUrlsFromSitemap(): AsyncIterable<string> {
    const index = parseSitemap(await this.deps.http.getText(`${this.baseUrl}/sitemap.xml`));
    yield* index.urls;

    for (const sitemapUrl of index.sitemaps) {
      const document = parseSitemap(await this.deps.http.getText(sitemapUrl));
      yield* document.urls;
    }
  }

  private async *fetchProducts(urls: string[]): AsyncIterable<CrawlItem> {
    for (const url of urls) {
      try {
        const html = await this.deps.http.getText(url);
        yield { ok: true, product: mapRennerProduct(parseRennerProductPage(html), url) };
      } catch (error) {
        if (error instanceof AccessDeniedError) throw error;
        yield {
          ok: false,
          reference: url,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }
}
