import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../../shared/utils/pagination.js';
import { crawlJobSchema } from '../crawl-jobs/crawl-job.schema.js';
import { paginationSchema } from '../products/product.schema.js';

export const sourceParamsSchema = z.object({ id: z.uuid() });

export const updateSourceBodySchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    baseUrl: z.url({ protocol: /^https?$/ }),
    enabled: z.boolean(),
    crawlInterval: z
      .number()
      .int()
      .min(15)
      .max(7 * 24 * 60)
      .nullable()
      .describe('Intervalo de sincronização automática em minutos (null desativa)'),
    maxPages: z
      .number()
      .int()
      .min(1)
      .max(5_000)
      .nullable()
      .describe('Limite de produtos por crawl'),
    config: z
      .record(z.string(), z.unknown())
      .nullable()
      .describe('Configuração específica da fonte. Nunca armazene segredos aqui.'),
  })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'At least one field is required' });

export type UpdateSourceBody = z.infer<typeof updateSourceBodySchema>;

export const syncSourceBodySchema = z
  .object({
    mode: z.enum(['crawl', 'search']).default('crawl'),
    query: z.string().trim().min(1).max(200).optional(),
    limit: z.number().int().min(1).max(5_000).optional(),
  })
  .strict()
  .refine((body) => body.mode !== 'search' || body.query, {
    message: 'query is required when mode is "search"',
    path: ['query'],
  });

export type SyncSourceBody = z.infer<typeof syncSourceBodySchema>;

export const listJobsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export const sourceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  baseUrl: z.string(),
  enabled: z.boolean(),
  crawlInterval: z.number().nullable(),
  maxPages: z.number().nullable(),
  config: z.record(z.string(), z.unknown()).nullable(),
  lastSyncAt: z.string().nullable(),
  productsCount: z.number(),
  crawlerAvailable: z.boolean().describe('Existe um crawler registrado para esta fonte'),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const sourceResponseSchema = z.object({ data: sourceSchema });
export const sourceListResponseSchema = z.object({ data: z.array(sourceSchema) });
export const crawlJobListResponseSchema = z.object({
  data: z.array(crawlJobSchema),
  pagination: paginationSchema,
});
