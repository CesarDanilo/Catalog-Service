import type { Crawler } from '../crawler.interface.js';
import { DEFAULT_CRAWL_LIMIT, type CrawlItem, type CrawlOptions } from '../crawler.types.js';
import { AccessDeniedError, type HttpClient } from '../shared/http-client.js';
import { mapVtexProduct } from './vtex.mapper.js';
import { parseResourcesTotal, parseVtexSearchResponse } from './vtex.parser.js';
import type { VtexStore } from './vtex.stores.js';

/** A API VTEX retorna no máximo 50 itens por página (_to - _from <= 49). */
const PAGE_SIZE = 50;
/** A API VTEX não pagina além do item 2500. */
const MAX_OFFSET = 2_500;

/** Termos usados na sincronização quando a loja não define categorias nem termos. */
export const DEFAULT_VTEX_SEARCH_TERMS = [
  'camiseta',
  'camisa',
  'blusa',
  'vestido',
  'saia',
  'calça',
  'bermuda',
  'short',
  'jaqueta',
  'moletom',
];

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
  return list.length ? list : undefined;
}

/**
 * Qualquer loja VTEX pelo catálogo público JSON (sem browser). A loja em si é só configuração
 * (`VtexStore`, em vtex.stores.ts).
 * Respeita o robots.txt das lojas: não usa os parâmetros ft=, fq=, O=, map= (bloqueados em várias);
 * termo e categoria vão no caminho da URL.
 *
 * `crawl()` percorre, nesta ordem de preferência: `Source.config.categories` (caminhos de
 * categoria), `Source.config.searchTerms`, as categorias padrão da loja ou os termos padrão.
 */
export class VtexCrawler implements Crawler {
  readonly source: string;
  private readonly baseUrl: string;

  constructor(
    private readonly http: HttpClient,
    private readonly store: VtexStore,
  ) {
    this.source = store.source;
    this.baseUrl = store.baseUrl;
  }

  search(query: string, options: CrawlOptions = {}): AsyncIterable<CrawlItem> {
    return this.paginate(encodeURIComponent(query.trim()), options.limit ?? DEFAULT_CRAWL_LIMIT);
  }

  async *crawl(options: CrawlOptions = {}): AsyncIterable<CrawlItem> {
    const limit = options.limit ?? DEFAULT_CRAWL_LIMIT;
    const targets = this.crawlTargets(options.config ?? {});

    // Divide o limite entre os alvos para não sincronizar só o primeiro.
    const perTarget = Math.max(1, Math.ceil(limit / targets.length));
    let produced = 0;
    let lastError: unknown;
    let failedTargets = 0;

    for (const { path, reference } of targets) {
      try {
        for await (const item of this.paginate(path, Math.min(perTarget, limit - produced))) {
          yield item;
          produced++;
        }
      } catch (error) {
        // Loja bloqueou: para tudo (insistir em outros alvos só piora).
        if (error instanceof AccessDeniedError) throw error;
        // Falha passageira numa página (a VTEX devolve 500 de vez em quando) não derruba a
        // sincronização inteira — registra como falha e segue pro próximo alvo.
        lastError = error;
        failedTargets++;
        yield {
          ok: false,
          reference,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      if (produced >= limit) return;
    }
    // Todos falharam (rede fora, API mudou): aí sim o job falha e pode ser repetido.
    if (failedTargets === targets.length && lastError) throw lastError;
  }

  private crawlTargets(
    config: Record<string, unknown>,
  ): Array<{ path: string; reference: string }> {
    const terms = stringList(config.searchTerms);
    const categories =
      stringList(config.categories) ?? (terms ? undefined : this.store.defaultCategories);
    if (categories) {
      return categories.map((category) => ({
        path: category.split('/').map(encodeURIComponent).join('/'),
        reference: `${this.baseUrl}/${category}`,
      }));
    }
    return (terms ?? this.store.defaultSearchTerms ?? DEFAULT_VTEX_SEARCH_TERMS).map((term) => ({
      path: encodeURIComponent(term.trim()),
      reference: `${this.baseUrl} busca "${term}"`,
    }));
  }

  private async *paginate(path: string, limit: number): AsyncIterable<CrawlItem> {
    let produced = 0;

    for (let from = 0; produced < limit && from < MAX_OFFSET; from += PAGE_SIZE) {
      const to = from + Math.min(PAGE_SIZE, limit - produced) - 1;
      const url = `${this.baseUrl}/api/catalog_system/pub/products/search/${path}?_from=${from}&_to=${to}`;
      const { data, headers } = await this.http.getJson(url);
      const entries = parseVtexSearchResponse(data);

      for (const entry of entries) {
        yield entry.ok ? { ok: true, product: mapVtexProduct(entry.product, this.store) } : entry;
        if (++produced >= limit) return;
      }

      const total = parseResourcesTotal(headers.get('resources'));
      if (entries.length < to - from + 1 || (total !== null && to + 1 >= total)) return;
    }
  }
}
