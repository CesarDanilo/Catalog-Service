import type { FastifyRequest } from 'fastify';
import { ok } from '../../shared/http/response.js';
import {
  listProductsQuerySchema,
  productParamsSchema,
  searchProductsQuerySchema,
} from './product.schema.js';
import type { ProductService } from './product.service.js';

export class ProductController {
  constructor(private readonly service: ProductService) {}

  list = async (request: FastifyRequest) => {
    const query = listProductsQuerySchema.parse(request.query);
    return this.service.list(query);
  };

  search = async (request: FastifyRequest) => {
    const query = searchProductsQuerySchema.parse(request.query);
    return this.service.list(query);
  };

  getById = async (request: FastifyRequest) => {
    const { id } = productParamsSchema.parse(request.params);
    return ok(await this.service.getById(id));
  };
}
