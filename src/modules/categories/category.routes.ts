import type { FastifyInstance } from 'fastify';
import { errorResponses, toJsonSchema } from '../../shared/http/openapi.js';
import type { CategoryController } from './category.controller.js';
import { categoryListResponseSchema, listCategoriesQuerySchema } from './category.schema.js';

export function categoryRoutes(controller: CategoryController) {
  return async (app: FastifyInstance) => {
    app.get(
      '/categories',
      {
        schema: {
          tags: ['categories'],
          summary: 'Lista categorias (plana ou em árvore)',
          querystring: toJsonSchema(listCategoriesQuerySchema),
          response: {
            200: toJsonSchema(categoryListResponseSchema, 'output'),
            ...errorResponses(400, 404),
          },
        },
      },
      controller.list,
    );
  };
}
