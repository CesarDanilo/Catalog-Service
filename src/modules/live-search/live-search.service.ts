import { cacheKeys, type CacheService } from '../../infrastructure/redis/cache.service.js';
import { NotFoundError } from '../../shared/errors/app-error.js';
import { buildPaginationMeta } from '../../shared/utils/pagination.js';
import { normalizeSearchQuery } from '../../shared/utils/text.js';
import type { Crawler } from '../crawlers/crawler.interface.js';
import type { ScrapedProduct } from '../crawlers/crawler.types.js';
import type {
  LiveSearchProduct,
  LiveSearchQuery,
  LiveSearchResponse,
} from './live-search.schema.js';

/** De onde vêm os providers (o CrawlerRegistry satisfaz). */
export interface LiveSearchProviders {
  get(source: string): Crawler | undefined;
}

interface CachedBatch {
  products: LiveSearchProduct[];
  country: string;
  language: string;
}

/**
 * Busca ao vivo em qualquer provider que implemente `liveSearch` — sem `if (source === ...)`.
 * Guarda o LOTE da busca no cache (Redis) e pagina sobre ele: "página 2" não faz outra busca
 * na fonte (na SerpApi, cada busca é paga). Buscas iguais simultâneas compartilham a mesma ida
 * à fonte. Nada é persistido no banco.
 */
export class LiveSearchService {
  private readonly inFlight = new Map<string, Promise<CachedBatch>>();

  constructor(
    private readonly providers: LiveSearchProviders,
    private readonly cache: CacheService,
    private readonly ttlSeconds: number,
  ) {}

  async search(source: string, query: LiveSearchQuery): Promise<LiveSearchResponse> {
    const provider = this.providers.get(source);
    const liveSearch = provider?.liveSearch?.bind(provider);
    if (!liveSearch) {
      throw new NotFoundError(
        'PROVIDER_NOT_FOUND',
        `Provider "${source}" does not support live search`,
      );
    }

    const key = cacheKeys.liveSearch(
      source,
      query.country ?? 'default',
      query.language ?? 'default',
      normalizeSearchQuery(query.q),
    );
    let cached = true;
    const batch = await this.cache.getOrSet(key, this.ttlSeconds, () => {
      cached = false;
      return this.loadOnce(key, () => load(liveSearch, source, query));
    });

    const start = (query.page - 1) * query.pageSize;
    return {
      data: batch.products.slice(start, start + query.pageSize),
      pagination: buildPaginationMeta(query, batch.products.length),
      meta: { source, country: batch.country, language: batch.language, cached },
    };
  }

  /** Buscas iguais ao mesmo tempo esperam a mesma promessa (uma ida só à fonte). */
  private loadOnce(key: string, loader: () => Promise<CachedBatch>): Promise<CachedBatch> {
    const running = this.inFlight.get(key);
    if (running) return running;
    const promise = loader().finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }
}

async function load(
  liveSearch: NonNullable<Crawler['liveSearch']>,
  source: string,
  query: LiveSearchQuery,
): Promise<CachedBatch> {
  const result = await liveSearch({
    query: query.q,
    country: query.country,
    language: query.language,
  });
  return {
    products: result.products.map((product, index) => toDto(product, index + 1, source)),
    country: result.country,
    language: result.language,
  };
}

function toDto(product: ScrapedProduct, position: number, source: string): LiveSearchProduct {
  return {
    position,
    externalId: product.externalId,
    title: product.name,
    price: product.price,
    currency: product.currency,
    ...(product.imageUrl && { imageUrl: product.imageUrl }),
    productUrl: product.productUrl,
    ...(product.seller && { seller: product.seller }),
    ...(product.rating !== undefined && { rating: product.rating }),
    ...(product.reviewCount !== undefined && { reviewCount: product.reviewCount }),
    source,
  };
}
