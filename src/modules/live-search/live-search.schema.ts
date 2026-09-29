import { z } from 'zod';
import { COUNTRY_CODE, LANGUAGE_TAG } from '../../shared/utils/market.js';
import { LIVE_SEARCH_MAX_QUERY_LENGTH } from '../crawlers/crawler.types.js';

export const LIVE_SEARCH_MAX_PAGE = 5;
export const LIVE_SEARCH_MAX_PAGE_SIZE = 40;
export const LIVE_SEARCH_DEFAULT_PAGE_SIZE = 20;

export const liveSearchParamsSchema = z.object({
  source: z
    .string()
    .regex(/^[a-z0-9-]{1,40}$/)
    .describe('Slug do provider (ex.: "google-shopping")'),
});

export const liveSearchQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(1)
    .max(LIVE_SEARCH_MAX_QUERY_LENGTH)
    .describe('Termo de busca (ex.: "camiseta preta")'),
  page: z.coerce.number().int().min(1).max(LIVE_SEARCH_MAX_PAGE).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(LIVE_SEARCH_MAX_PAGE_SIZE)
    .default(LIVE_SEARCH_DEFAULT_PAGE_SIZE),
  country: z
    .string()
    .regex(COUNTRY_CODE)
    .transform((value) => value.toUpperCase())
    .optional()
    .describe('Mercado (ISO 3166-1 alpha-2, ex.: BR, US, PT). Padrão: o configurado'),
  language: z
    .string()
    .regex(LANGUAGE_TAG)
    .optional()
    .describe('Idioma (ex.: pt-BR, en). Padrão: o configurado'),
});

export type LiveSearchQuery = z.infer<typeof liveSearchQuerySchema>;

// ---------- Schemas de resposta (documentação OpenAPI) ----------

export const liveSearchProductSchema = z.object({
  position: z.number().int(),
  externalId: z.string(),
  title: z.string(),
  price: z.number(),
  currency: z.string(),
  imageUrl: z.string().optional(),
  productUrl: z.string(),
  seller: z.string().optional(),
  rating: z.number().optional(),
  reviewCount: z.number().int().optional(),
  source: z.string(),
});

export type LiveSearchProduct = z.infer<typeof liveSearchProductSchema>;

export const liveSearchResponseSchema = z.object({
  data: z.array(liveSearchProductSchema),
  pagination: z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  }),
  meta: z.object({
    source: z.string(),
    country: z.string(),
    language: z.string(),
    cached: z.boolean(),
  }),
});

export type LiveSearchResponse = z.infer<typeof liveSearchResponseSchema>;
