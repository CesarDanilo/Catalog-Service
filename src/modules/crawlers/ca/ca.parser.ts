import { z } from 'zod';
import { CrawlerError } from '../../../shared/errors/app-error.js';

/**
 * Formato do catálogo público VTEX usado pela C&A:
 *   GET https://www.cea.com.br/api/catalog_system/pub/products/search/{termo|caminho-da-categoria}?_from=&_to=
 * Estrutura verificada em 2026-09-23 (ver tests/fixtures/ca-search.json).
 * Só os campos usados são validados; o restante é ignorado.
 */
const offerSchema = z.object({
  Price: z.number(),
  ListPrice: z.number().optional(),
  IsAvailable: z.boolean(),
});

const itemSchema = z.object({
  itemId: z.string(),
  name: z.string().optional(),
  Tamanho: z.array(z.string()).optional(),
  Cor: z.array(z.string()).optional(),
  images: z.array(z.object({ imageUrl: z.string() })).default([]),
  sellers: z.array(z.object({ commertialOffer: offerSchema })).default([]),
});

export const vtexProductSchema = z.object({
  productId: z.string(),
  productName: z.string(),
  brand: z.string().optional(),
  description: z.string().optional(),
  link: z.string(),
  categories: z.array(z.string()).default([]),
  Cor: z.array(z.string()).optional(),
  Marcas: z.array(z.string()).optional(),
  Gênero: z.array(z.string()).optional(),
  items: z.array(itemSchema).default([]),
});

export type VtexProduct = z.infer<typeof vtexProductSchema>;
export type VtexItem = z.infer<typeof itemSchema>;

export type ParsedEntry =
  { ok: true; product: VtexProduct } | { ok: false; reference: string; error: string };

/** Valida cada produto isoladamente: um item malformado não invalida a página inteira. */
export function parseVtexSearchResponse(payload: unknown): ParsedEntry[] {
  if (!Array.isArray(payload)) {
    throw new CrawlerError('Unexpected VTEX search response: expected an array', false);
  }
  return payload.map((entry, index) => {
    const parsed = vtexProductSchema.safeParse(entry);
    if (parsed.success) return { ok: true, product: parsed.data };
    const reference = (entry as { productId?: string } | null)?.productId ?? `index:${index}`;
    return { ok: false, reference, error: parsed.error.issues.map((i) => i.message).join('; ') };
  });
}

/** Header `resources: 0-49/37175` -> 37175. */
export function parseResourcesTotal(header: string | null): number | null {
  const match = header?.match(/\/(\d+)$/);
  return match?.[1] ? Number(match[1]) : null;
}
