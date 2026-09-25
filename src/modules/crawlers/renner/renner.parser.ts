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

/** Cartão de produto da página de busca renderizada (/b?Ntt=). */
export interface RennerSearchCard {
  externalId: string;
  productUrl: string;
  name: string;
  /** Preço atual (com desconto, quando houver). */
  price: number;
  /** Preço "de" riscado, só quando há desconto. */
  listPrice?: number;
  imageUrl?: string;
  available: boolean;
}

/** "R$ 1.299,90" -> 1299.9 */
function parseBrl(text: string): number | undefined {
  const digits = text.replace(/[^\d,]/g, '').replace(',', '.');
  const value = Number(digits);
  return digits && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Cartões da busca: cada um já traz nome, preço(s), foto e link — dá pra salvar a peça SEM abrir a
 * página de cada produto (~1,5s cada). Seletores por prefixo de classe (`ProductBox_*`): o sufixo
 * é hash do build do site e muda a cada deploy deles. Cartão incompleto é ignorado.
 */
export function parseSearchCards(html: string, baseUrl: string): RennerSearchCard[] {
  const $ = cheerio.load(html);
  const cards: RennerSearchCard[] = [];
  const seen = new Set<string>();

  $('a[class*="ProductBox_productBox"]').each((_, element) => {
    const box = $(element);
    const href = box.attr('href');
    if (!href || !/-br\.lr/.test(href)) return;
    const productUrl = new URL(href.split('?')[0] ?? href, baseUrl).toString();
    const externalId = extractProductIdFromUrl(productUrl);
    const name = (
      box.find('h3').first().text() ||
      box.find('img').first().attr('alt') ||
      ''
    ).trim();
    const priceBox = box.find('[class*="ProductBox_price"]').first();
    const listPrice = parseBrl(priceBox.find('[class*="listPrice"]').first().text());
    const price = parseBrl(priceBox.find('span').not('[class*="listPrice"]').last().text());
    if (!externalId || !name || price === undefined || seen.has(externalId)) return;
    seen.add(externalId);

    const availability = box.find('[class*="ProductBox_productAvailability"]').attr('class') ?? '';
    const imageUrl = box.find('img').first().attr('src');
    cards.push({
      externalId,
      productUrl,
      name,
      price,
      ...(listPrice !== undefined && listPrice > price ? { listPrice } : {}),
      ...(imageUrl ? { imageUrl: new URL(imageUrl, baseUrl).toString() } : {}),
      available: /(^|\s)ProductBox_available__/.test(availability),
    });
  });
  return cards;
}

/** ".../p/slug/-/A-931612620-br.lr" -> "931612620". */
export function extractProductIdFromUrl(url: string): string | null {
  return url.match(/\/A-(\d+)-br\.lr/)?.[1] ?? null;
}

/** ".../p/camisa-polo-preta/-/A-1-br.lr" -> "camisa polo preta". */
export function extractSlugText(url: string): string {
  return (url.match(/\/p\/([^/]+)\//)?.[1] ?? '').replace(/-/g, ' ');
}
