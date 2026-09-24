import { sortSizes } from '../../../shared/utils/sizes.js';
import type { ScrapedProduct } from '../crawler.types.js';
import type { VtexItem, VtexProduct } from './ca.parser.js';

function bestOffer(items: VtexItem[]) {
  const offers = items.flatMap((item) =>
    item.sellers.map((seller) => ({ item, offer: seller.commertialOffer })),
  );
  const available = offers.filter(({ offer }) => offer.IsAvailable && offer.Price > 0);
  const candidates = available.length ? available : offers.filter(({ offer }) => offer.Price > 0);
  return candidates.sort((a, b) => a.offer.Price - b.offer.Price)[0];
}

function availableSizes(items: VtexItem[]): string | undefined {
  const sizes = items
    .filter((item) => item.sellers.some((seller) => seller.commertialOffer.IsAvailable))
    .flatMap((item) => item.Tamanho ?? []);
  const sorted = sortSizes(sizes);
  return sorted.length ? sorted.join(', ') : undefined;
}

/** VTEX (C&A) -> ScrapedProduct. Um produto VTEX agrupa SKUs (tamanhos) da mesma cor. */
export function mapVtexProduct(product: VtexProduct): ScrapedProduct {
  const best = bestOffer(product.items);
  const images = (best?.item ?? product.items[0])?.images.map((image) => image.imageUrl) ?? [];

  return {
    externalId: product.productId,
    name: product.productName,
    description: product.description,
    // "Marcas" traz a marca própria (ex.: "Clock House"); "brand" costuma ser "C&A".
    brand: product.Marcas?.[0] ?? product.brand,
    category: product.categories[0],
    gender: product['Gênero']?.[0],
    color: product.Cor?.[0],
    size: availableSizes(product.items),
    price: best?.offer.Price ?? 0,
    originalPrice: best?.offer.ListPrice,
    currency: 'BRL',
    imageUrl: images[0],
    images,
    productUrl: product.link,
    available: product.items.some((item) =>
      item.sellers.some((seller) => seller.commertialOffer.IsAvailable),
    ),
    rawData: {
      productId: product.productId,
      productName: product.productName,
      brand: product.brand,
      categories: product.categories,
      link: product.link,
      skus: product.items.map((item) => ({
        itemId: item.itemId,
        size: item.Tamanho?.[0],
        color: item.Cor?.[0],
        price: item.sellers[0]?.commertialOffer.Price,
        listPrice: item.sellers[0]?.commertialOffer.ListPrice,
        available: item.sellers[0]?.commertialOffer.IsAvailable,
      })),
    },
  };
}
