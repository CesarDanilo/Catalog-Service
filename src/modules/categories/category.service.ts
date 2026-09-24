import { env } from '../../config/env.js';
import type { CacheService } from '../../infrastructure/redis/cache.service.js';
import { cacheKeys } from '../../infrastructure/redis/cache.service.js';
import { NotFoundError } from '../../shared/errors/app-error.js';
import type { CategoryRecord, CategoryRepository } from './category.repository.js';
import type { CategoryNode, ListCategoriesQuery } from './category.schema.js';

export class CategoryService {
  constructor(
    private readonly repository: CategoryRepository,
    private readonly cache: CacheService,
  ) {}

  async list(query: ListCategoriesQuery): Promise<CategoryNode[]> {
    const all = await this.getAll();
    let parentId: string | null = null;

    if (query.parent) {
      const parent = all.find((category) => category.slug === query.parent);
      if (!parent) throw new NotFoundError('CATEGORY_NOT_FOUND', 'Category not found');
      parentId = parent.id;
    }

    if (query.tree) return buildTree(all, parentId);
    if (query.parent) return all.filter((category) => category.parentId === parentId);
    return all;
  }

  /**
   * Retorna o id da categoria e de todas as descendentes.
   * Filtrar por "roupas" inclui "vestidos", "camisas" etc. Retorna [] se o slug não existir.
   */
  async resolveIdsWithDescendants(slug: string): Promise<string[]> {
    const all = await this.getAll();
    const root = all.find((category) => category.slug === slug);
    if (!root) return [];

    const ids = [root.id];
    for (let i = 0; i < ids.length; i++) {
      for (const category of all) if (category.parentId === ids[i]) ids.push(category.id);
    }
    return ids;
  }

  /** Mapa slug -> id usado pelo crawler para vincular produtos às categorias. */
  async getSlugToIdMap(): Promise<Map<string, string>> {
    const all = await this.getAll();
    return new Map(all.map((category) => [category.slug, category.id]));
  }

  private getAll(): Promise<CategoryRecord[]> {
    // Tabela pequena e raramente alterada: cacheada inteira.
    return this.cache.getOrSet(cacheKeys.categories(), env.CACHE_PRODUCT_TTL, () =>
      this.repository.findAll(),
    );
  }
}

export function buildTree(categories: CategoryRecord[], parentId: string | null): CategoryNode[] {
  return categories
    .filter((category) => category.parentId === parentId)
    .map((category) => ({ ...category, children: buildTree(categories, category.id) }));
}
