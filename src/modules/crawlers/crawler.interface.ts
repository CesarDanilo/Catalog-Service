import type {
  CrawlItem,
  CrawlOptions,
  LiveSearchParams,
  LiveSearchResult,
} from './crawler.types.js';

/**
 * Contrato de um crawler de loja. Novas lojas implementam esta interface e são registradas
 * no CrawlerRegistry — o restante da aplicação não conhece detalhes da fonte.
 *
 * Os métodos retornam AsyncIterable para que produtos sejam persistidos à medida que chegam,
 * sem manter o catálogo inteiro da fonte em memória.
 */
export interface Crawler {
  /** Slug da Source correspondente (ex.: "renner"). */
  readonly source: string;

  /** Busca produtos por termo na fonte. */
  search(query: string, options?: CrawlOptions): AsyncIterable<CrawlItem>;

  /** Sincroniza o catálogo (ou parte configurada dele). */
  crawl(options?: CrawlOptions): AsyncIterable<CrawlItem>;

  /**
   * Busca ao vivo na fonte, sem persistir (opcional). Só fontes que implementam aparecem em
   * GET /api/v1/providers/:source/search.
   */
  liveSearch?(params: LiveSearchParams): Promise<LiveSearchResult>;

  /** Libera recursos (ex.: browser do Playwright). */
  close?(): Promise<void>;
}
