import type { FastifyInstance } from 'fastify';
import { errorResponses, toJsonSchema } from '../../shared/http/openapi.js';
import { crawlJobResponseSchema } from '../crawl-jobs/crawl-job.schema.js';
import type { SourceController } from './source.controller.js';
import {
  crawlJobListResponseSchema,
  listJobsQuerySchema,
  sourceListResponseSchema,
  sourceParamsSchema,
  sourceResponseSchema,
  syncSourceBodySchema,
  updateSourceBodySchema,
} from './source.schema.js';

export function sourceRoutes(controller: SourceController) {
  return async (app: FastifyInstance) => {
    const tags = ['sources'];
    const params = toJsonSchema(sourceParamsSchema);

    app.get(
      '/sources',
      {
        schema: {
          tags,
          summary: 'Lista as fontes (lojas)',
          response: { 200: toJsonSchema(sourceListResponseSchema, 'output') },
        },
      },
      controller.list,
    );

    app.get(
      '/sources/:id',
      {
        schema: {
          tags,
          summary: 'Detalhe de uma fonte',
          params,
          response: {
            200: toJsonSchema(sourceResponseSchema, 'output'),
            ...errorResponses(400, 404),
          },
        },
      },
      controller.getById,
    );

    app.patch(
      '/sources/:id',
      {
        schema: {
          tags,
          summary: 'Atualiza configuração da fonte (enabled, crawlInterval, maxPages...)',
          params,
          body: toJsonSchema(updateSourceBodySchema),
          response: {
            200: toJsonSchema(sourceResponseSchema, 'output'),
            ...errorResponses(400, 404),
          },
        },
      },
      controller.update,
    );

    app.post(
      '/sources/:id/sync',
      {
        schema: {
          tags,
          summary: 'Enfileira uma sincronização (crawl) da fonte',
          description:
            'Cria um CrawlJob PENDING e o envia para a fila `crawler`. O processamento é ' +
            'assíncrono: acompanhe em GET /api/v1/crawl-jobs/{id}. Corpo opcional.',
          params,
          body: toJsonSchema(syncSourceBodySchema),
          response: {
            202: toJsonSchema(crawlJobResponseSchema, 'output'),
            ...errorResponses(400, 404, 409),
          },
        },
      },
      controller.sync,
    );

    app.get(
      '/sources/:id/jobs',
      {
        schema: {
          tags,
          summary: 'Histórico de crawl jobs da fonte',
          params,
          querystring: toJsonSchema(listJobsQuerySchema),
          response: {
            200: toJsonSchema(crawlJobListResponseSchema, 'output'),
            ...errorResponses(400, 404),
          },
        },
      },
      controller.listJobs,
    );
  };
}
