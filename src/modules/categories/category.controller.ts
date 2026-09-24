import type { FastifyRequest } from 'fastify';
import { ok } from '../../shared/http/response.js';
import { listCategoriesQuerySchema } from './category.schema.js';
import type { CategoryService } from './category.service.js';

export class CategoryController {
  constructor(private readonly service: CategoryService) {}

  list = async (request: FastifyRequest) => {
    const query = listCategoriesQuerySchema.parse(request.query);
    return ok(await this.service.list(query));
  };
}
