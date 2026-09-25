import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../../shared/utils/pagination.js';
import { PRODUCT_SORTS } from './product.types.js';

const optionalText = (description: string) =>
  z.string().trim().min(1).max(100).optional().describe(description);

const price = (description: string) => z.coerce.number().min(0).optional().describe(description);

export const listProductsQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional().describe('Termo de busca (ex.: "camisa preta")'),
    category: optionalText('Slug da categoria; inclui subcategorias (ex.: "vestidos")'),
    gender: optionalText('masculino | feminino | unissex | infantil (aceita sinônimos)'),
    excludeGender: optionalText(
      'Esconde peças deste gênero (ex.: "infantil"); peças sem gênero continuam aparecendo',
    ),
    includeNeutral: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional()
      .describe(
        'Com gender=masculino/feminino, inclui também peças unissex e sem gênero identificado (bolsas, óculos, tênis...)',
      ),
    brand: optionalText('Marca (comparação exata, sem diferenciar maiúsculas)'),
    color: optionalText('Cor (ex.: "preto"; aceita sinônimos como "preta")'),
    source: optionalText('Slug da fonte (ex.: "renner")'),
    minPrice: price('Preço mínimo'),
    maxPrice: price('Preço máximo'),
    available: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional()
      .describe('Filtra por disponibilidade'),
    sort: z.enum(PRODUCT_SORTS).default('relevance').describe('Ordenação'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  })
  .refine(
    (query) =>
      query.minPrice === undefined ||
      query.maxPrice === undefined ||
      query.minPrice <= query.maxPrice,
    { message: 'minPrice must be less than or equal to maxPrice', path: ['minPrice'] },
  );

export const searchProductsQuerySchema = listProductsQuerySchema.and(
  z.object({ q: z.string().trim().min(1).max(200).describe('Termo de busca (obrigatório)') }),
);

export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

export const productParamsSchema = z.object({ id: z.uuid() });

// ---------- Schemas de resposta (documentação OpenAPI) ----------

const summarySchema = z.object({ id: z.uuid(), name: z.string(), slug: z.string() });

export const productListItemSchema = z.object({
  id: z.uuid(),
  externalId: z.string(),
  name: z.string().meta({ examples: ['Camisa Masculina Preta'] }),
  slug: z.string(),
  brand: z.string().nullable(),
  category: summarySchema.nullable(),
  gender: z
    .string()
    .nullable()
    .meta({ examples: ['masculino'] }),
  color: z
    .string()
    .nullable()
    .meta({ examples: ['preto'] }),
  size: z.string().nullable(),
  price: z.number().meta({ examples: [129.9] }),
  originalPrice: z.number().nullable(),
  currency: z.string().meta({ examples: ['BRL'] }),
  imageUrl: z.string().nullable(),
  productUrl: z.string(),
  available: z.boolean(),
  source: summarySchema,
  lastScrapedAt: z.string(),
});

export const productDetailSchema = productListItemSchema.extend({
  description: z.string().nullable(),
  imageCachedUrl: z.string().nullable(),
  images: z.array(
    z.object({ url: z.string(), cachedUrl: z.string().nullable(), position: z.number() }),
  ),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const paginationSchema = z.object({
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  totalPages: z.number(),
});

export const productListResponseSchema = z.object({
  data: z.array(productListItemSchema),
  pagination: paginationSchema,
});

export const productDetailResponseSchema = z.object({ data: productDetailSchema });
