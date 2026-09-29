/** Estrutura comum que todo crawler produz, independente da fonte. */
export interface ScrapedProduct {
  externalId: string;
  name: string;
  description?: string;
  brand?: string;

  /** Texto livre de categoria da fonte (ex.: "/Moda Feminina/Roupas/Vestidos/"). */
  category?: string;
  gender?: string;
  color?: string;
  size?: string;

  price: number;
  originalPrice?: number;
  currency: string;

  imageUrl?: string;
  /** Todas as imagens conhecidas, em ordem. A primeira deve ser igual a `imageUrl`. */
  images?: string[];

  productUrl: string;
  available: boolean;

  /** Loja que vende a peça, quando a fonte é um marketplace/comparador (ex.: Google Shopping). */
  seller?: string;
  /** Nota média (0–5) e quantidade de avaliações, quando a fonte informa. */
  rating?: number;
  reviewCount?: number;

  /** Payload original (reduzido) para auditoria/debug. */
  rawData?: unknown;
}

export interface CrawlOptions {
  /** Número máximo de produtos a produzir nesta execução. */
  limit?: number;
  /** Configuração específica da fonte vinda de Source.config. */
  config?: Record<string, unknown>;
  signal?: AbortSignal;
}

/** Item produzido pelo crawler: um produto ou uma falha isolada (não interrompe o crawl). */
export type CrawlItem =
  { ok: true; product: ScrapedProduct } | { ok: false; reference: string; error: string };

export const DEFAULT_CRAWL_LIMIT = 50;

/** Tamanho máximo do termo de uma busca ao vivo (caracteres). */
export const LIVE_SEARCH_MAX_QUERY_LENGTH = 120;

/** Busca ao vivo (sem persistir): o que o endpoint /providers/:source/search pede à fonte. */
export interface LiveSearchParams {
  query: string;
  /** Mercado (ISO 3166-1 alpha-2) e idioma; ausentes = padrão configurado na fonte. */
  country?: string;
  language?: string;
  signal?: AbortSignal;
}

export interface LiveSearchResult {
  /** Lote de resultados da fonte, em ordem de relevância (a paginação anda sobre ele). */
  products: ScrapedProduct[];
  /** Mercado efetivamente usado. */
  country: string;
  language: string;
}
