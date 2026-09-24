import { z } from 'zod';

export const listCategoriesQuerySchema = z.object({
  parent: z.string().trim().min(1).max(100).optional().describe('Slug da categoria pai'),
  tree: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true')
    .describe('Quando true, retorna as categorias aninhadas em `children`'),
});

export type ListCategoriesQuery = z.infer<typeof listCategoriesQuerySchema>;

const baseCategorySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  parentId: z.uuid().nullable(),
});

export interface CategoryNode extends z.infer<typeof baseCategorySchema> {
  children?: CategoryNode[];
}

export const categoryNodeSchema: z.ZodType<CategoryNode> = baseCategorySchema.extend({
  get children() {
    return z.array(categoryNodeSchema).optional();
  },
});

export const categoryListResponseSchema = z.object({ data: z.array(categoryNodeSchema) });
