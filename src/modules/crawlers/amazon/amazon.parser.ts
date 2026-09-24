import { z } from 'zod';

/**
 * Formato INTERNO que um provedor autorizado da Amazon deve entregar ao crawler.
 * Não é o formato de nenhuma API da Amazon: é o contrato deste serviço, para que a
 * integração futura (API oficial, programa de afiliados ou feed) só precise converter
 * a resposta dela para este shape.
 *
 * TODO(amazon): implementar um AmazonCatalogProvider com uma fonte autorizada e converter a
 * resposta real para AmazonCatalogItem. Não há scraping de páginas da Amazon neste projeto.
 */
export const amazonCatalogItemSchema = z.object({
  asin: z.string().min(1),
  title: z.string().min(1),
  brand: z.string().optional(),
  price: z.number().positive(),
  listPrice: z.number().positive().optional(),
  currency: z.string().default('BRL'),
  imageUrls: z.array(z.string()).default([]),
  detailPageUrl: z.string().url(),
  available: z.boolean().default(true),
  category: z.string().optional(),
  color: z.string().optional(),
  size: z.string().optional(),
});

export type AmazonCatalogItem = z.infer<typeof amazonCatalogItemSchema>;

export function parseAmazonCatalogItem(input: unknown) {
  return amazonCatalogItemSchema.safeParse(input);
}
