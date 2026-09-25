import type { Crawler } from '../crawler.interface.js';
import { DEFAULT_CRAWL_LIMIT, type CrawlItem, type CrawlOptions } from '../crawler.types.js';
import { normalizeCategory } from '../normalizer/product.normalizer.js';
import type { BrowserPool } from '../shared/browser.js';
import { AccessDeniedError, type HttpClient } from '../shared/http-client.js';
import { parseSitemap } from '../shared/sitemap.js';
import { mapRennerProduct, mapRennerSearchCard } from './renner.mapper.js';
import {
  extractSlugText,
  parseProductLinks,
  parseRennerProductPage,
  parseSearchCards,
  type RennerSearchCard,
} from './renner.parser.js';

/** Filtro de gênero da busca da Renner (`filtros=gender:Masculino;`) -> gênero do catálogo. */
const SEARCH_GENDERS = [
  ['Masculino', 'masculino'],
  ['Feminino', 'feminino'],
] as const;

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
 * - search(): a página de busca (/b?Ntt=) é renderizada no cliente (Playwright). Busca masculino
 *   e feminino em paralelo (filtro de gênero da própria loja) e lê as peças direto dos cartões
 *   (~40 por página em ~5s) — o cartão não diz o gênero, o filtro diz. Se a página mudar e não
 *   houver cartões, cai no método antigo: links da busca + página de cada produto via HTTP.
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

    const pages = await Promise.all(
      SEARCH_GENDERS.map(([filter]) =>
        this.render(`${url}&filtros=${encodeURIComponent(`gender:${filter};`)}`),
      ),
    );
    const byGender = pages.map((html) => parseSearchCards(html, this.baseUrl));
    const cards = mergeByGender(byGender);
    if (cards.length > 0) {
      for (const { card, gender } of cards.slice(0, limit)) {
        yield { ok: true, product: mapRennerSearchCard(card, gender) };
      }
      return;
    }

    // Sem cartões (layout mudou?): método antigo, mais lento mas independente dos cartões.
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

/**
 * Junta as buscas por gênero intercalando (o limite fica dividido entre os dois). Peça que
 * aparece nas duas buscas é unissex.
 */
function mergeByGender(
  byGender: RennerSearchCard[][],
): Array<{ card: RennerSearchCard; gender: string }> {
  const genders = new Map<string, Set<string>>();
  byGender.forEach((cards, index) => {
    for (const card of cards) {
      const set = genders.get(card.externalId) ?? new Set<string>();
      set.add(SEARCH_GENDERS[index]![1]);
      genders.set(card.externalId, set);
    }
  });

  const merged: Array<{ card: RennerSearchCard; gender: string }> = [];
  const emitted = new Set<string>();
  const longest = Math.max(0, ...byGender.map((cards) => cards.length));
  for (let i = 0; i < longest; i++) {
    for (const cards of byGender) {
      const card = cards[i];
      if (!card || emitted.has(card.externalId)) continue;
      emitted.add(card.externalId);
      const found = genders.get(card.externalId)!;
      merged.push({ card, gender: found.size > 1 ? 'unissex' : [...found][0]! });
    }
  }
  return merged;
}
