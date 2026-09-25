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
  type RennerFindDoc,
} from './renner.parser.js';

export const RENNER_DEFAULT_BASE_URL = 'https://www.lojasrenner.com.br';

export interface RennerCrawlerDeps {
  http: HttpClient;
  browser: BrowserPool;
  userAgent: string;
  timeoutMs: number;
  baseUrl?: string;
  /** Pausa entre páginas de busca na sincronização por termos (scraping responsável). */
  pageDelayMs?: number;
}

/** A página de busca da Renner mostra 40 peças; `&pagina=N` pede as seguintes. */
const DEFAULT_PAGE_DELAY_MS = 1_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Renner.
 * - crawl(): com Source.config.searchTerms (["vestido", "calça jeans", ...]), sincroniza pela
 *   busca — cada termo, página a página, do mesmo jeito rápido do search() (~40 peças por página).
 *   Sem termos, percorre o sitemap público (permitido pelo robots.txt) e visita cada produto de
 *   vestuário via HTTP + Cheerio (lento: ~1,5s por peça).
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
    const url = this.searchUrl(query);

    const docs = await this.searchPage(query, 1);
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

  private searchUrl(query: string, page = 1): string {
    const url = `${this.baseUrl}/b?Ntt=${encodeURIComponent(query.trim())}`;
    return page > 1 ? `${url}&pagina=${page}` : url;
  }

  /** Uma página da busca (40 peças), lida da resposta que a própria página recebe. */
  private async searchPage(query: string, page: number): Promise<RennerFindDoc[]> {
    const response = await this.deps.browser.captureJson(this.searchUrl(query, page), {
      userAgent: this.deps.userAgent,
      timeoutMs: this.deps.timeoutMs,
      responseUrl: RENNER_SEARCH_RESPONSE_URL,
    });
    return parseFindResponse(response);
  }

  /**
   * Sincronização pela busca: o limite é dividido entre os termos; cada termo avança página a
   * página até a sua cota ou até acabar. Peça repetida entre termos entra uma vez só. Termo que
   * falha vira uma falha registrada e o resto segue; se todos falharem, o crawl falha.
   */
  private async *crawlBySearchTerms(terms: string[], limit: number): AsyncIterable<CrawlItem> {
    const perTerm = Math.max(1, Math.ceil(limit / terms.length));
    const delayMs = this.deps.pageDelayMs ?? DEFAULT_PAGE_DELAY_MS;
    const seen = new Set<string>();
    let produced = 0;
    let failedTerms = 0;
    let lastError: unknown;

    for (const term of terms) {
      let fromTerm = 0;
      try {
        for (let page = 1; fromTerm < perTerm && produced < limit; page++) {
          if (produced > 0 || page > 1) await sleep(delayMs);
          const docs = await this.searchPage(term, page);
          let newOnPage = 0;
          for (const doc of docs) {
            const product = mapRennerFindDoc(doc, this.baseUrl);
            if (seen.has(product.externalId)) continue;
            seen.add(product.externalId);
            newOnPage++;
            yield { ok: true, product };
            fromTerm++;
            if (++produced >= limit || fromTerm >= perTerm) break;
          }
          // Acabaram as páginas do termo (vazia, ou só peças já vistas).
          if (newOnPage === 0) break;
        }
      } catch (error) {
        if (error instanceof AccessDeniedError) throw error;
        failedTerms++;
        lastError = error;
        yield {
          ok: false,
          reference: this.searchUrl(term),
          error: error instanceof Error ? error.message : String(error),
        };
      }
      if (produced >= limit) return;
    }
    if (failedTerms === terms.length && lastError) throw lastError;
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
    const terms = options.config?.searchTerms;
    if (Array.isArray(terms) && terms.some((t) => typeof t === 'string' && t.trim())) {
      yield* this.crawlBySearchTerms(
        terms.filter((t): t is string => typeof t === 'string' && !!t.trim()),
        limit,
      );
      return;
    }

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
