import type { FastifyInstance } from 'fastify';
import { errorResponses, toJsonSchema } from '../../shared/http/openapi.js';
import type { ProductController } from './product.controller.js';
import {
  listProductsQuerySchema,
  productDetailResponseSchema,
  productListResponseSchema,
  productParamsSchema,
  searchProductsQuerySchema,
} from './product.schema.js';

export function productRoutes(controller: ProductController) {
  return async (app: FastifyInstance) => {
    const listResponse = {
      200: toJsonSchema(productListResponseSchema, 'output'),
      ...errorResponses(400, 429),
    };

    app.get(
      '/products',
      {
        schema: {
          tags: ['products'],
          summary: 'Lista produtos com filtros, ordenação e paginação',
          querystring: toJsonSchema(listProductsQuerySchema),
          response: listResponse,
        },
      },
      controller.list,
    );

    app.get(
      '/products/search',
      {
        schema: {
          tags: ['products'],
          summary: 'Busca textual no catálogo persistido (q obrigatório)',
          description:
            'Busca sem acentos e sem diferenciar maiúsculas. Todos os termos precisam casar. ' +
            'Ordenação padrão por relevância (similaridade trigram).',
          querystring: toJsonSchema(searchProductsQuerySchema),
          response: listResponse,
        },
      },
      controller.search,
    );

    app.get(
      '/products/:id',
      {
        schema: {
          tags: ['products'],
          summary: 'Detalhe de um produto',
          params: toJsonSchema(productParamsSchema),
          response: {
            200: toJsonSchema(productDetailResponseSchema, 'output'),
            ...errorResponses(400, 404),
          },
        },
      },
      controller.getById,
    );
  };
}
