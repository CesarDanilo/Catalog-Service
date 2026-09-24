import * as cheerio from 'cheerio';
import { z } from 'zod';

/**
 * Página de produto da Renner (Next.js), estrutura verificada em 2026-09-23
 * (ver tests/fixtures/renner-product.html):
 *  - <script type="application/ld+json"> com @type "Product" (schema.org) — fonte principal;
 *  - <script id="__NEXT_DATA__"> com props.pageProps.product — enriquecimento opcional
 *    (preço de lista, variante cor|tamanho, estoque).
 */
const jsonLdProductSchema = z.object({
  '@type': z.literal('Product'),
  name: z.string(),
  description: z.string().optional(),
  sku: z.string().optional(),
  image: z.union([z.string(), z.array(z.string())]).optional(),
  brand: z.object({ name: z.string() }).partial().optional(),
  offers: z
    .object({
      price: z.union([z.string(), z.number()]),
      priceCurrency: z.string().optional(),
      availability: z.string().optional(),
      url: z.string().optional(),
    })
    .optional(),
});

const nextProductSchema = z
  .object({
    productId: z.string(),
    displayName: z.string(),
    listPrice: z.number(),
    variants: z.string(),
    outOfStock: z.boolean(),
    purchasable: z.boolean(),
  })
  .partial();

export type RennerJsonLdProduct = z.infer<typeof jsonLdProductSchema>;
export type RennerNextProduct = z.infer<typeof nextProductSchema>;

export interface RennerProductPage {
  jsonLd: RennerJsonLdProduct;
  next: RennerNextProduct | null;
}

export class RennerParseError extends Error {}

export function parseRennerProductPage(html: string): RennerProductPage {
  const $ = cheerio.load(html);

  let jsonLd: RennerJsonLdProduct | null = null;
  $('script[type="application/ld+json"]').each((_, element) => {
    if (jsonLd) return;
    try {
      const parsed = jsonLdProductSchema.safeParse(JSON.parse($(element).text()));
      if (parsed.success) jsonLd = parsed.data;
    } catch {
      // Outros blocos JSON-LD (Organization, Breadcrumb...) são ignorados.
    }
  });
  if (!jsonLd) throw new RennerParseError('Product JSON-LD not found on page');

  return { jsonLd, next: parseNextProduct($('script#__NEXT_DATA__').text()) };
}

function parseNextProduct(raw: string): RennerNextProduct | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as { props?: { pageProps?: { product?: unknown } } };
    const parsed = nextProductSchema.safeParse(data.props?.pageProps?.product);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Links de produto (/p/...-br.lr) em uma página de listagem/busca renderizada. */
export function parseProductLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const links = $('a[href*="/p/"]')
    .map((_, element) => $(element).attr('href'))
    .get()
    .filter((href): href is string => typeof href === 'string' && /-br\.lr/.test(href))
    .map((href) => new URL(href.split('?')[0] ?? href, baseUrl).toString());
  return [...new Set(links)];
}

/** ".../p/slug/-/A-931612620-br.lr" -> "931612620". */
export function extractProductIdFromUrl(url: string): string | null {
  return url.match(/\/A-(\d+)-br\.lr/)?.[1] ?? null;
}

/** ".../p/camisa-polo-preta/-/A-1-br.lr" -> "camisa polo preta". */
export function extractSlugText(url: string): string {
  return (url.match(/\/p\/([^/]+)\//)?.[1] ?? '').replace(/-/g, ' ');
}
