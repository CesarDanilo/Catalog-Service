import type { FastifyInstance } from 'fastify';
import { errorResponses, toJsonSchema } from '../../shared/http/openapi.js';
import type { CrawlJobController } from './crawl-job.controller.js';
import { crawlJobParamsSchema, crawlJobResponseSchema } from './crawl-job.schema.js';

export function crawlJobRoutes(controller: CrawlJobController) {
  return async (app: FastifyInstance) => {
    app.get(
      '/crawl-jobs/:id',
      {
        schema: {
          tags: ['sources'],
          summary: 'Status e métricas de um crawl job',
          params: toJsonSchema(crawlJobParamsSchema),
          response: {
            200: toJsonSchema(crawlJobResponseSchema, 'output'),
            ...errorResponses(400, 404),
          },
        },
      },
      controller.getById,
    );
  };
}
