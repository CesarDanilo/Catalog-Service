import { z } from 'zod';

export const crawlJobParamsSchema = z.object({ id: z.uuid() });

export const crawlJobSchema = z.object({
  id: z.uuid(),
  sourceId: z.uuid(),
  status: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED']),
  params: z
    .object({
      mode: z.enum(['crawl', 'search']),
      query: z.string().optional(),
      limit: z.number().optional(),
    })
    .nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  productsFound: z.number(),
  productsCreated: z.number(),
  productsUpdated: z.number(),
  productsFailed: z.number(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const crawlJobResponseSchema = z.object({ data: crawlJobSchema });
