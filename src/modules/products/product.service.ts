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
    const cacheKey = cacheKeys.search({
      ...listQuery.filters,
      sort: query.sort,
      page: query.page,
      pageSize: query.pageSize,
    });

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
    if (query.color) filters.color = normalizeColor(query.color) ?? normalizeText(query.color);
    if (query.category) {
      filters.categoryIds = await this.categoryService.resolveIdsWithDescendants(query.category);
    }
    return filters;
  }
}
