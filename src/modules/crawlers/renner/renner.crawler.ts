import type { Crawler } from '../crawler.interface.js';
import { DEFAULT_CRAWL_LIMIT, type CrawlItem, type CrawlOptions } from '../crawler.types.js';
import { normalizeCategory } from '../normalizer/product.normalizer.js';
import type { BrowserPool } from '../shared/browser.js';
import { AccessDeniedError, type HttpClient } from '../shared/http-client.js';
import { parseSitemap } from '../shared/sitemap.js';
import { mapRennerFindDoc, mapRennerProduct } from './renner.mapper.js';
import {
  extractSlugText,
  parseFindResponse,
  parseProductLinks,
  parseRennerProductPage,
  RENNER_SEARCH_RESPONSE_URL,
} from './renner.parser.js';

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
 * - search(): abre a página de busca (/b?Ntt=, permitida no robots.txt) no navegador e lê a
 *   resposta que a PRÓPRIA página busca no provedor de busca da loja ao carregar — ~40 peças
 *   completas (gênero, cor, categoria, preço, fotos, estoque) em poucos segundos, sem abrir cada
 *   produto nem esperar a vitrine desenhar. Nunca chamamos essa API direto (o robots.txt do
 *   provedor proíbe robôs): é o mesmo tráfego de uma visita comum à busca. Se a resposta não vier,
 *   cai no método antigo: links da busca + página de cada produto via HTTP.
 */
export class RennerCrawler implements Crawler {
  readonly source = 'renner';
  private readonly baseUrl: string;

  constructor(private readonly deps: RennerCrawlerDeps) {
    this.baseUrl = deps.baseUrl ?? RENNER_DEFAULT_BASE_URL;
  }

  async *search(query: string, options: CrawlOptions = {}): AsyncIterable<CrawlItem> {
    const limit = options.limit ?? DEFAULT_CRAWL_LIMIT;
    const url = `${this.baseUrl}/b?Ntt=${encodeURIComponent(query.trim())}`;

    const response = await this.deps.browser.captureJson(url, {
      userAgent: this.deps.userAgent,
      timeoutMs: this.deps.timeoutMs,
      responseUrl: RENNER_SEARCH_RESPONSE_URL,
    });
    const docs = parseFindResponse(response);
    if (docs.length > 0) {
      for (const doc of docs.slice(0, limit)) {
        yield { ok: true, product: mapRennerFindDoc(doc, this.baseUrl) };
      }
      return;
    }

    // Sem a resposta (provedor mudou?): método antigo, lento mas independente dela.
    const links = parseProductLinks(await this.render(url), this.baseUrl).slice(0, limit);
    yield* this.fetchProducts(links);
  }

  private render(url: string): Promise<string> {
    return this.deps.browser.renderHtml(url, {
      userAgent: this.deps.userAgent,
      timeoutMs: this.deps.timeoutMs,
      waitForSelector: 'a[href*="/p/"]',
    });
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
