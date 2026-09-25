import type { ScrapedProduct } from '../crawler.types.js';
import {
  extractProductIdFromUrl,
  type RennerFindDoc,
  type RennerProductPage,
} from './renner.parser.js';

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

/**
 * Produto da resposta de busca -> ScrapedProduct. Traz o que a página de produto traria (gênero,
 * cor, categoria, marca, preço cheio e com desconto, fotos, estoque) sem precisar abri-la.
 */
export function mapRennerFindDoc(doc: RennerFindDoc, baseUrl: string): ScrapedProduct {
  const productUrl = new URL(doc.linkId.split('?')[0] ?? doc.linkId, baseUrl).toString();
  const cents = doc.effectivePriceCents ?? doc.salePriceCents ?? doc.priceCents ?? 0;
  const price = cents / 100;
  const listPrice = doc.priceCents !== undefined ? doc.priceCents / 100 : undefined;
  const images = [doc.imageId, doc.front_still_image_url, doc.second_image_url].filter(
    (url, index, all): url is string => !!url && all.indexOf(url) === index,
  );

  return {
    externalId: extractProductIdFromUrl(productUrl) ?? doc.parent_product_id ?? doc.id,
    name: doc.name,
    ...(doc.brand ? { brand: doc.brand } : {}),
    // "Feminino Masculino" -> unissex no normalizador.
    ...(doc.gender?.length ? { gender: doc.gender.join(' ') } : {}),
    ...(doc.parent_color?.[0] ? { color: doc.parent_color[0] } : {}),
    ...(doc.parent_categories?.length ? { category: doc.parent_categories.join('/') } : {}),
    price,
    ...(listPrice !== undefined && listPrice > price ? { originalPrice: listPrice } : {}),
    currency: 'BRL',
    ...(images.length ? { imageUrl: images[0], images } : {}),
    productUrl,
    available: doc.in_stock !== false,
    rawData: { origin: 'search-api', id: doc.id },
  };
}
