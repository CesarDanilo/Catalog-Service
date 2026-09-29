import { sortSizes } from '../../../shared/utils/sizes.js';
import type { ScrapedProduct } from '../crawler.types.js';
import { readAttribute, type VtexItem, type VtexProduct } from './vtex.parser.js';

/** Nomes das especificações nas lojas VTEX conhecidas (comparação sem caixa/acento). */
const ATTRIBUTES = {
  size: ['Tamanho'],
  color: ['Cor', 'Cores'],
  gender: ['Gênero', 'gender'],
  /** "Adulto" / "Infantil" / "adult" — o normalizador reconhece infantil/kids/juvenil/bebê. */
  ageGroup: ['Faixa Etária', 'Idade', 'age_group'],
  /** Marca própria (ex.: "Clock House" na C&A); sem ela, `brand`. */
  brand: ['Marcas'],
} as const;

export interface VtexMappingOptions {
  /** Gênero da loja quando o produto não informa (ex.: "masculino" numa loja só masculina). */
  defaultGender?: string;
}

function bestOffer(items: VtexItem[]) {
  const offers = items.flatMap((item) =>
    item.sellers.map((seller) => ({ item, offer: seller.commertialOffer })),
  );
  const available = offers.filter(({ offer }) => offer.IsAvailable && offer.Price > 0);
  const candidates = available.length ? available : offers.filter(({ offer }) => offer.Price > 0);
  return candidates.sort((a, b) => a.offer.Price - b.offer.Price)[0];
}

const isAvailable = (item: VtexItem) =>
  item.sellers.some((seller) => seller.commertialOffer.IsAvailable);

function availableSizes(items: VtexItem[]): string | undefined {
  const sizes = items
    .filter(isAvailable)
    .flatMap((item) => readAttribute(item, ATTRIBUTES.size) ?? []);
  const sorted = sortSizes(sizes);
  return sorted.length ? sorted.join(', ') : undefined;
}

/** Gênero + faixa etária num texto só ("Feminino Infantil"); o normalizador decide. */
function genderText(product: VtexProduct, defaultGender?: string): string | undefined {
  const parts = [
    readAttribute(product, ATTRIBUTES.gender) ?? defaultGender,
    readAttribute(product, ATTRIBUTES.ageGroup),
  ].filter(Boolean);
  return parts.length ? parts.join(' ') : undefined;
}

/** Produto VTEX -> ScrapedProduct. Um produto VTEX agrupa SKUs (tamanhos) da mesma cor. */
export function mapVtexProduct(
  product: VtexProduct,
  options: VtexMappingOptions = {},
): ScrapedProduct {
  const best = bestOffer(product.items);
  const reference = best?.item ?? product.items[0];
  const images = reference?.images.map((image) => image.imageUrl) ?? [];

  return {
    externalId: product.productId,
    name: product.productName,
    description: product.description,
    brand: readAttribute(product, ATTRIBUTES.brand) ?? product.brand,
    category: product.categories[0],
    gender: genderText(product, options.defaultGender),
    color:
      readAttribute(product, ATTRIBUTES.color) ??
      (reference && readAttribute(reference, ATTRIBUTES.color)),
    size: availableSizes(product.items),
    price: best?.offer.Price ?? 0,
    originalPrice: best?.offer.ListPrice,
    currency: 'BRL',
    imageUrl: images[0],
    images,
    productUrl: product.link,
    available: product.items.some(isAvailable),
    rawData: {
      productId: product.productId,
      productName: product.productName,
      brand: product.brand,
      categories: product.categories,
      link: product.link,
      skus: product.items.map((item) => ({
        itemId: item.itemId,
        size: readAttribute(item, ATTRIBUTES.size),
        color: readAttribute(item, ATTRIBUTES.color),
        price: item.sellers[0]?.commertialOffer.Price,
        listPrice: item.sellers[0]?.commertialOffer.ListPrice,
        available: item.sellers[0]?.commertialOffer.IsAvailable,
      })),
    },
  };
}
