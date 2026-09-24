import type { ScrapedProduct } from '../crawler.types.js';
import { extractProductIdFromUrl, type RennerProductPage } from './renner.parser.js';

const IN_STOCK = /schema\.org\/(InStock|LimitedAvailability|OnlineOnly)$/;

/** Página de produto da Renner -> ScrapedProduct. */
export function mapRennerProduct(page: RennerProductPage, pageUrl: string): ScrapedProduct {
  const { jsonLd, next } = page;
  const images = jsonLd.image === undefined ? [] : [jsonLd.image].flat();
  const productUrl = jsonLd.offers?.url ?? pageUrl;
  const externalId =
    next?.productId ??
    extractProductIdFromUrl(pageUrl) ??
    extractProductIdFromUrl(productUrl) ??
    '';

  // `variants` vem como "Cor|Tamanho" da variante exibida (ex.: "Branco|G").
  const [color] = next?.variants?.split('|') ?? [];

  const inStock = jsonLd.offers?.availability ? IN_STOCK.test(jsonLd.offers.availability) : false;

  return {
    externalId,
    name: jsonLd.name,
    description: jsonLd.description,
    brand: jsonLd.brand?.name,
    color: color || undefined,
    price: Number(jsonLd.offers?.price ?? 0),
    originalPrice: next?.listPrice,
    currency: jsonLd.offers?.priceCurrency ?? 'BRL',
    imageUrl: images[0],
    images,
    productUrl,
    available: inStock && next?.outOfStock !== true,
    rawData: {
      sku: jsonLd.sku,
      offers: jsonLd.offers,
      next: next && {
        productId: next.productId,
        displayName: next.displayName,
        listPrice: next.listPrice,
        variants: next.variants,
        outOfStock: next.outOfStock,
        purchasable: next.purchasable,
      },
    },
  };
}
