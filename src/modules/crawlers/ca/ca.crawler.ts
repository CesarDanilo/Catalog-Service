import type { Crawler } from '../crawler.interface.js';
import { DEFAULT_CRAWL_LIMIT, type CrawlItem, type CrawlOptions } from '../crawler.types.js';
import { AccessDeniedError, type HttpClient } from '../shared/http-client.js';
import { mapVtexProduct } from './ca.mapper.js';
import { parseResourcesTotal, parseVtexSearchResponse } from './ca.parser.js';

export const CA_DEFAULT_BASE_URL = 'https://www.cea.com.br';
/** Caminhos de categoria sincronizados por padrão (sobrescreva com Source.config.categories). */
export const CA_DEFAULT_CATEGORIES = ['moda-feminina/roupas', 'moda-masculina/roupas'];
/** A API VTEX retorna no máximo 50 itens por página (_to - _from <= 49). */
const PAGE_SIZE = 50;
/** A API VTEX não pagina além do item 2500. */
const MAX_OFFSET = 2_500;

/**
 * C&A — usa o catálogo público VTEX (JSON), sem necessidade de browser.
 * Respeita o robots.txt: não usa os parâmetros bloqueados (ft=, fq=, O=, map=);
 * termo e categoria vão no caminho da URL.
 */
export class CACrawler implements Crawler {
  readonly source = 'ca';

  constructor(
    private readonly http: HttpClient,
    private readonly baseUrl = CA_DEFAULT_BASE_URL,
  ) {}

  search(query: string, options: CrawlOptions = {}): AsyncIterable<CrawlItem> {
    return this.paginate(encodeURIComponent(query.trim()), options.limit ?? DEFAULT_CRAWL_LIMIT);
  }

  async *crawl(options: CrawlOptions = {}): AsyncIterable<CrawlItem> {
    const limit = options.limit ?? DEFAULT_CRAWL_LIMIT;
    const configured = options.config?.categories;
    const categories = Array.isArray(configured)
      ? configured.filter((c): c is string => typeof c === 'string')
      : CA_DEFAULT_CATEGORIES;

    // Divide o limite entre as categorias para não sincronizar só a primeira.
    const perCategory = Math.max(1, Math.ceil(limit / categories.length));
    let produced = 0;
    let lastError: unknown;
    let failedCategories = 0;

    for (const category of categories) {
      const path = category.split('/').map(encodeURIComponent).join('/');
      try {
        for await (const item of this.paginate(path, Math.min(perCategory, limit - produced))) {
          yield item;
          produced++;
        }
      } catch (error) {
        // Loja bloqueou: para tudo (insistir em outras categorias só piora).
        if (error instanceof AccessDeniedError) throw error;
        // Falha passageira numa página (a VTEX devolve 500 de vez em quando) não derruba a
        // sincronização inteira — registra como falha e segue pra próxima categoria.
        lastError = error;
        failedCategories++;
        yield {
          ok: false,
          reference: `${this.baseUrl}/${category}`,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      if (produced >= limit) return;
    }
    // Todas falharam (rede fora, API mudou): aí sim o job falha e pode ser repetido.
    if (failedCategories === categories.length && lastError) throw lastError;
  }

  private async *paginate(path: string, limit: number): AsyncIterable<CrawlItem> {
    let produced = 0;

    for (let from = 0; produced < limit && from < MAX_OFFSET; from += PAGE_SIZE) {
      const to = from + Math.min(PAGE_SIZE, limit - produced) - 1;
      const url = `${this.baseUrl}/api/catalog_system/pub/products/search/${path}?_from=${from}&_to=${to}`;
      const { data, headers } = await this.http.getJson(url);
      const entries = parseVtexSearchResponse(data);

      for (const entry of entries) {
        yield entry.ok ? { ok: true, product: mapVtexProduct(entry.product) } : entry;
        if (++produced >= limit) return;
      }

      const total = parseResourcesTotal(headers.get('resources'));
      if (entries.length < to - from + 1 || (total !== null && to + 1 >= total)) return;
    }
  }
}
