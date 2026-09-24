import type { PaginationParams } from '../../shared/utils/pagination.js';

export const PRODUCT_SORTS = ['relevance', 'price_asc', 'price_desc', 'newest'] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

/** Filtros já resolvidos/normalizados, prontos para o repository. */
export interface ProductFilters {
  /** Termos normalizados (sem acento, minúsculos). Todos precisam casar. */
  terms: string[];
  /** Texto original normalizado, usado para ranquear por similaridade. */
  query?: string;
  categoryIds?: string[];
  gender?: string;
  brand?: string;
  color?: string;
  source?: string;
  minPrice?: number;
  maxPrice?: number;
  available?: boolean;
}

export interface ProductListQuery extends PaginationParams {
  filters: ProductFilters;
  sort: ProductSort;
}

export interface SourceSummary {
  id: string;
  name: string;
  slug: string;
}

export interface CategorySummary {
  id: string;
  name: string;
  slug: string;
}

/** Formato de produto exposto pela API (listagem). */
export interface ProductListItem {
  id: string;
  externalId: string;
  name: string;
  slug: string;
  brand: string | null;
  category: CategorySummary | null;
  gender: string | null;
  color: string | null;
  size: string | null;
  price: number;
  originalPrice: number | null;
  currency: string;
  imageUrl: string | null;
  productUrl: string;
  available: boolean;
  source: SourceSummary;
  lastScrapedAt: string;
}

export interface ProductImageDto {
  url: string;
  cachedUrl: string | null;
  position: number;
}

/** Formato de produto exposto pela API (detalhe). */
export interface ProductDetail extends ProductListItem {
  description: string | null;
  imageCachedUrl: string | null;
  images: ProductImageDto[];
  createdAt: string;
  updatedAt: string;
}

export interface UpsertResult {
  id: string;
  created: boolean;
}
