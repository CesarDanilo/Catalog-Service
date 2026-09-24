import { describe, expect, it, vi } from 'vitest';
import type { CacheService } from '../../src/infrastructure/redis/cache.service.js';
import type { CategoryService } from '../../src/modules/categories/category.service.js';
import type { ProductRepository } from '../../src/modules/products/product.repository.js';
import { listProductsQuerySchema } from '../../src/modules/products/product.schema.js';
import { ProductService } from '../../src/modules/products/product.service.js';
import type { ProductListQuery } from '../../src/modules/products/product.types.js';
import { NotFoundError } from '../../src/shared/errors/app-error.js';

function memoryCache(): CacheService & { keys: string[] } {
  const store = new Map<string, unknown>();
  return {
    get keys() {
      return [...store.keys()];
    },
    get: async <T>(key: string) => (store.get(key) as T) ?? null,
    set: async (key, value) => void store.set(key, value),
    del: async (...keys) => keys.forEach((key) => store.delete(key)),
    async getOrSet<T>(key: string, _ttl: number, loader: () => Promise<T>) {
      if (store.has(key)) return store.get(key) as T;
      const value = await loader();
      if (value !== null) store.set(key, value);
      return value;
    },
  };
}

function setup() {
  const repository = {
    findMany: vi.fn(async (_query: ProductListQuery) => ({ items: [], total: 0 })),
    findById: vi.fn(async () => null),
    upsert: vi.fn(async () => ({ id: 'p1', created: true })),
  };
  const categories = { resolveIdsWithDescendants: vi.fn(async () => ['c1', 'c2']) };
  const cache = memoryCache();
  const service = new ProductService(
    repository as unknown as ProductRepository,
    categories as unknown as CategoryService,
    cache,
  );
  return { service, repository, categories, cache };
}

const query = (input: Record<string, string>) => listProductsQuerySchema.parse(input);

describe('ProductService.list', () => {
  it('normaliza filtros antes de consultar o repository', async () => {
    const { service, repository } = setup();
    await service.list(
      query({ q: 'Camisa Preta', gender: 'Masculina', color: 'PRETA', category: 'roupas' }),
    );

    const [listQuery] = repository.findMany.mock.calls[0]!;
    expect(listQuery.filters).toMatchObject({
      terms: ['camisa', 'preto'],
      query: 'camisa preta',
      gender: 'masculino',
      color: 'preto',
      categoryIds: ['c1', 'c2'],
    });
    expect(listQuery).toMatchObject({ sort: 'relevance', page: 1, pageSize: 20 });
  });

  it('retorna envelope { data, pagination }', async () => {
    const { service, repository } = setup();
    repository.findMany.mockResolvedValueOnce({ items: [], total: 45 });
    const result = await service.list(query({ pageSize: '20', page: '2' }));
    expect(result.pagination).toEqual({ page: 2, pageSize: 20, total: 45, totalPages: 3 });
  });

  it('requisições equivalentes compartilham o cache', async () => {
    const { service, repository, cache } = setup();
    await service.list(query({ q: 'camisa preta', color: 'preta' }));
    await service.list(query({ color: 'Preto', q: 'Camisa  PRETA' }));
    expect(repository.findMany).toHaveBeenCalledTimes(1);
    expect(cache.keys.filter((key) => key.startsWith('catalog:search:'))).toHaveLength(1);
  });
});

describe('ProductService.getById / saveScraped', () => {
  it('lança PRODUCT_NOT_FOUND', async () => {
    const { service } = setup();
    await expect(service.getById('x')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('invalida o cache do produto após salvar', async () => {
    const { service, cache } = setup();
    await cache.set('catalog:product:p1', { stale: true }, 60);
    await service.saveScraped('s1', {} as never, null, new Date());
    expect(cache.keys).not.toContain('catalog:product:p1');
  });
});

describe('listProductsQuerySchema', () => {
  it('aplica defaults e limita pageSize a 100', () => {
    expect(query({})).toMatchObject({ page: 1, pageSize: 20, sort: 'relevance' });
    expect(() => query({ pageSize: '101' })).toThrow();
    expect(() => query({ minPrice: '100', maxPrice: '10' })).toThrow(/minPrice/);
    expect(() => query({ sort: 'name; DROP TABLE' })).toThrow();
  });
});
