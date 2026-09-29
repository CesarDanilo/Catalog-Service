import { z } from 'zod';
import { CrawlerError } from '../../../shared/errors/app-error.js';
import { normalizeText } from '../../../shared/utils/text.js';

/**
 * Catálogo público VTEX, igual em todas as lojas da plataforma:
 *   GET https://<loja>/api/catalog_system/pub/products/search/{termo|caminho-da-categoria}?_from=&_to=
 * Estrutura verificada em C&A (2026-09-23) e Hering, Reserva, Malwee, Aramis, Mash, Lupo
 * (2026-09-29) — ver tests/fixtures/ca-search.json e tests/fixtures/vtex/.
 *
 * Os campos fixos são validados; as especificações de cada loja (cor, gênero, tamanho...) mudam de
 * nome e caixa ("Cor", "COR", "Gênero", "GÊNERO", "gender") e são lidas com `readAttribute`.
 */
const offerSchema = z.object({
  Price: z.number(),
  ListPrice: z.number().optional(),
  IsAvailable: z.boolean(),
});

const itemSchema = z
  .object({
    itemId: z.string(),
    name: z.string().optional(),
    images: z.array(z.object({ imageUrl: z.string() })).default([]),
    sellers: z.array(z.object({ commertialOffer: offerSchema })).default([]),
  })
  .catchall(z.unknown());

export const vtexProductSchema = z
  .object({
    productId: z.string(),
    productName: z.string(),
    brand: z.string().optional(),
    description: z.string().optional(),
    link: z.string(),
    categories: z.array(z.string()).default([]),
    items: z.array(itemSchema).default([]),
  })
  .catchall(z.unknown());

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

/**
 * Primeiro valor de uma especificação, procurando pelos nomes na ordem dada, sem diferenciar
 * maiúsculas nem acentos: `readAttribute(p, ['Gênero'])` acha "Gênero", "GÊNERO" e "genero".
 * Especificações VTEX vêm como lista de textos (`"Cor": ["Preto"]`).
 */
export function readAttribute(
  record: Record<string, unknown>,
  names: readonly string[],
): string | undefined {
  const byKey = new Map(Object.entries(record).map(([key, value]) => [normalizeText(key), value]));
  for (const name of names) {
    const value = byKey.get(normalizeText(name));
    const values = Array.isArray(value) ? value : [value];
    const text = values.find((v): v is string => typeof v === 'string' && v.trim() !== '');
    if (text) return text.trim();
  }
  return undefined;
}
