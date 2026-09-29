import type { FastifyRequest } from 'fastify';
import { liveSearchParamsSchema, liveSearchQuerySchema } from './live-search.schema.js';
import type { LiveSearchService } from './live-search.service.js';

export class LiveSearchController {
  constructor(private readonly service: LiveSearchService) {}

  search = async (request: FastifyRequest) => {
    const { source } = liveSearchParamsSchema.parse(request.params);
    const query = liveSearchQuerySchema.parse(request.query);
    return this.service.search(source, query);
  };
}
