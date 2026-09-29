import type { FastifyInstance } from 'fastify';
import { errorResponses, toJsonSchema } from '../../shared/http/openapi.js';
import type { LiveSearchController } from './live-search.controller.js';
import {
  liveSearchParamsSchema,
  liveSearchQuerySchema,
  liveSearchResponseSchema,
} from './live-search.schema.js';

/** Cada busca nova vai à fonte externa (paga ou sujeita a bloqueio): limite bem menor que o global. */
const LIVE_SEARCH_RATE_LIMIT = { max: 30, timeWindow: '1 minute' };

export function liveSearchRoutes(controller: LiveSearchController) {
  return async (app: FastifyInstance) => {
    app.get(
      '/providers/:source/search',
      {
        config: { rateLimit: LIVE_SEARCH_RATE_LIMIT },
        schema: {
          tags: ['providers'],
          summary: 'Busca ao vivo num provider externo (ex.: google-shopping), sem persistir',
          description:
            'Consulta a fonte na hora (com cache do lote por termo+mercado) e devolve produtos ' +
            'normalizados. A paginação anda sobre o lote da fonte. Erros: 404 PROVIDER_NOT_FOUND, ' +
            '503 <PROVIDER>_UNAVAILABLE / _BLOCKED, 504 <PROVIDER>_TIMEOUT.',
          params: toJsonSchema(liveSearchParamsSchema),
          querystring: toJsonSchema(liveSearchQuerySchema),
          response: {
            200: toJsonSchema(liveSearchResponseSchema, 'output'),
            ...errorResponses(400, 404, 429, 502, 503, 504),
          },
        },
      },
      controller.search,
    );
  };
}
