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
