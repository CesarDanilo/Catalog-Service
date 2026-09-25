import { env } from '../../config/env.js';
import type { CacheService } from '../../infrastructure/redis/cache.service.js';
import { cacheKeys } from '../../infrastructure/redis/cache.service.js';
import { NotFoundError } from '../../shared/errors/app-error.js';
import { buildPaginationMeta, type Paginated } from '../../shared/utils/pagination.js';
import { normalizeText } from '../../shared/utils/text.js';
import type { CategoryService } from '../categories/category.service.js';
import {
  normalizeColor,
  normalizeGender,
  type NormalizedProduct,
} from '../crawlers/normalizer/product.normalizer.js';
import type { ListProductsQuery } from './product.schema.js';
import { toSearchTerms } from './product.search.js';
import type { ProductRepository } from './product.repository.js';
import type {
  ProductDetail,
  ProductFilters,
  ProductListItem,
  ProductListQuery,
  UpsertResult,
} from './product.types.js';

/** Bem maior que CACHE_TTL: se a versão expirar, as buscas da versão antiga já expiraram antes. */
const SEARCH_VERSION_TTL_SECONDS = 24 * 60 * 60;

export class ProductService {
  constructor(
    private readonly repository: ProductRepository,
    private readonly categoryService: CategoryService,
    private readonly cache: CacheService,
  ) {}

  /** Listagem/busca no catálogo persistido. Nunca consulta as lojas em tempo real. */
  async list(query: ListProductsQuery): Promise<Paginated<ProductListItem>> {
    const listQuery: ProductListQuery = {
      filters: await this.resolveFilters(query),
      sort: query.sort,
      page: query.page,
      pageSize: query.pageSize,
    };

    // Filtros normalizados: "Preta" e "preto" compartilham a mesma entrada de cache.
    const version = (await this.cache.get<number>(cacheKeys.searchVersion())) ?? 0;
    const cacheKey = cacheKeys.search(
      { ...listQuery.filters, sort: query.sort, page: query.page, pageSize: query.pageSize },
      version,
    );

    return this.cache.getOrSet(cacheKey, env.CACHE_TTL, async () => {
      const { items, total } = await this.repository.findMany(listQuery);
      return { data: items, pagination: buildPaginationMeta(listQuery, total) };
    });
  }

  async getById(id: string): Promise<ProductDetail> {
    const product = await this.cache.getOrSet(cacheKeys.product(id), env.CACHE_PRODUCT_TTL, () =>
      this.repository.findById(id),
    );
    if (!product) throw new NotFoundError('PRODUCT_NOT_FOUND', 'Product not found');
    return product;
  }

  /** Persiste um produto normalizado (create/update idempotente) e invalida o cache dele. */
  async saveScraped(
    sourceId: string,
    product: NormalizedProduct,
    categoryId: string | null,
    scrapedAt: Date,
  ): Promise<UpsertResult> {
    const result = await this.repository.upsert(sourceId, product, categoryId, scrapedAt);
    await this.cache.del(cacheKeys.product(result.id));
    return result;
  }

  /**
   * Descarta todas as buscas cacheadas (troca a versão da chave). Chamado quando um crawl salva
   * produtos: sem isto, a busca sob demanda do backend (pede o termo às lojas e reconsulta) recebia
   * de novo o resultado VAZIO cacheado antes do crawl, por até CACHE_TTL.
   */
  async invalidateSearches(): Promise<void> {
    await this.cache.set(cacheKeys.searchVersion(), Date.now(), SEARCH_VERSION_TTL_SECONDS);
  }

  private async resolveFilters(query: ListProductsQuery): Promise<ProductFilters> {
    const filters: ProductFilters = {
      terms: query.q ? toSearchTerms(query.q) : [],
      brand: query.brand,
      source: query.source,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
      available: query.available,
    };

    const normalizedQuery = query.q ? normalizeText(query.q) : '';
    if (normalizedQuery) filters.query = normalizedQuery;
    if (query.gender) filters.gender = normalizeGender(query.gender) ?? normalizeText(query.gender);
    if (query.gender && query.includeNeutral) filters.includeNeutralGender = true;
    if (query.color) filters.color = normalizeColor(query.color) ?? normalizeText(query.color);
    if (query.category) {
      filters.categoryIds = await this.categoryService.resolveIdsWithDescendants(query.category);
    }
    return filters;
  }
}
