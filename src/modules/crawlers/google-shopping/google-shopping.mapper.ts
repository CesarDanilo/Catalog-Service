import { createHash } from 'node:crypto';
import type { CrawlItem } from '../crawler.types.js';
import type { RawGoogleShoppingProduct } from './google-shopping.types.js';

/**
 * RawGoogleShoppingProduct -> ScrapedProduct (o formato comum a todas as fontes).
 * Título, link e preço são obrigatórios no domínio; sem um deles o resultado vira falha isolada
 * (`ok: false`) — nada é inventado. Moeda sem símbolo reconhecível usa a do mercado configurado.
 */
export function mapGoogleShoppingProduct(
  raw: RawGoogleShoppingProduct,
  defaultCurrency: string,
): CrawlItem {
  const { title, productUrl, price } = raw;
  if (!title || !productUrl || price === undefined) {
    const missing = Object.entries({ title, productUrl, price })
      .filter(([, value]) => value === undefined || value === '')
      .map(([field]) => field);
    return {
      ok: false,
      reference: raw.externalId ?? `position-${raw.position}`,
      error: `missing ${missing.join(', ')}`,
    };
  }

  return {
    ok: true,
    product: {
      externalId: raw.externalId ?? urlId(productUrl),
      name: title,
      price,
      currency: raw.currency ?? defaultCurrency,
      productUrl,
      ...(raw.imageUrl && { imageUrl: raw.imageUrl, images: [raw.imageUrl] }),
      // Está à venda na vitrine do Google Shopping; estoque por tamanho não é informado.
      available: true,
      ...(raw.seller && { seller: raw.seller }),
      ...(raw.rating !== undefined && { rating: raw.rating }),
      ...(raw.reviewCount !== undefined && { reviewCount: raw.reviewCount }),
      rawData: { position: raw.position },
    },
  };
}

/** Id estável derivado do link, pra resultados sem id próprio. */
function urlId(url: string): string {
  return `url-${createHash('sha256').update(url).digest('hex').slice(0, 24)}`;
}
