import type { PrismaClient } from '@prisma/client';

export interface CategoryRecord {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
}

const categorySelect = { id: true, name: true, slug: true, parentId: true } as const;

export class CategoryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findAll(): Promise<CategoryRecord[]> {
    return this.prisma.category.findMany({ select: categorySelect, orderBy: { name: 'asc' } });
  }

  findBySlug(slug: string): Promise<CategoryRecord | null> {
    return this.prisma.category.findUnique({ where: { slug }, select: categorySelect });
  }
}
