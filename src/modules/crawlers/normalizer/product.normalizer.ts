import { parsePrice } from '../../../shared/utils/price.js';
import { slugify } from '../../../shared/utils/slug.js';
import { cleanWhitespace, normalizeText, toTitleCase } from '../../../shared/utils/text.js';
import type { ScrapedProduct } from '../crawler.types.js';
import {
  CATEGORY_KEYWORDS,
  COLOR_KEYWORDS,
  GENDER_KEYWORDS,
  GENDERS,
  type Gender,
} from './dictionaries.js';

const MAX_DESCRIPTION_LENGTH = 5_000;
const MAX_IMAGES = 10;

/** Produto pronto para persistência: valores canônicos e validados. */
export interface NormalizedProduct {
  externalId: string;
  name: string;
  slug: string;
  description: string | null;
  brand: string | null;
  categorySlug: string | null;
  gender: Gender | null;
  color: string | null;
  size: string | null;
  price: number;
  originalPrice: number | null;
  currency: string;
  imageUrl: string | null;
  images: string[];
  productUrl: string;
  available: boolean;
  searchText: string;
  rawData: unknown;
}

export class ProductNormalizationError extends Error {
  constructor(
    readonly externalId: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProductNormalizationError';
  }
}

/**
 * Procura, na ordem em que aparecem no texto, a primeira palavra/frase do dicionário.
 * Em nomes de produto em português o substantivo principal costuma vir primeiro
 * ("Blusa de Moletom" é blusa, não casaco).
 * Retorna `undefined` quando nada casa e o valor do dicionário (inclusive `null`) quando casa.
 */
export function findKeyword<T>(text: string, dictionary: Record<string, T>): T | undefined {
  const tokens = normalizeText(text).split(' ').filter(Boolean);
  const maxPhraseLength = Math.max(...Object.keys(dictionary).map((k) => k.split(' ').length));

  for (let i = 0; i < tokens.length; i++) {
    for (let size = Math.min(maxPhraseLength, tokens.length - i); size >= 1; size--) {
      const phrase = tokens.slice(i, i + size).join(' ');
      if (phrase in dictionary) return dictionary[phrase];
    }
  }
  return undefined;
}

export function normalizeGender(...texts: Array<string | undefined>): Gender | null {
  for (const text of texts) {
    if (!text) continue;
    const found = new Set<Gender>();
    for (const token of normalizeText(text).split(' ')) {
      const gender = GENDER_KEYWORDS[token];
      if (gender) found.add(gender);
    }
    if (found.has('infantil')) return 'infantil';
    if (found.has('unissex')) return 'unissex';
    if (found.has('masculino') && found.has('feminino')) return 'unissex';
    const [first] = found;
    if (first) return first;
  }
  return null;
}

export function isGender(value: string): value is Gender {
  return (GENDERS as readonly string[]).includes(value);
}

export function normalizeColor(...texts: Array<string | undefined>): string | null {
  for (const text of texts) {
    if (!text) continue;
    const color = findKeyword(text, COLOR_KEYWORDS);
    if (color) return color;
  }
  return null;
}

/** Retorna o slug da categoria. Itens explicitamente fora de vestuário retornam null. */
export function normalizeCategory(...texts: Array<string | undefined>): string | null {
  for (const text of texts) {
    if (!text) continue;
    const category = findKeyword(text, CATEGORY_KEYWORDS);
    if (category !== undefined) return category;
  }
  return null;
}

export function normalizeName(name: string): string {
  const cleaned = cleanWhitespace(name);
  // Algumas fontes (ex.: C&A) publicam nomes todo em minúsculo.
  return cleaned === cleaned.toLowerCase() ? toTitleCase(cleaned) : cleaned;
}

export function normalizeUrl(url: string | undefined, baseUrl?: string): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  const withProtocol = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
  try {
    const parsed = baseUrl ? new URL(withProtocol, baseUrl) : new URL(withProtocol);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function normalizeDescription(description: string | undefined): string | null {
  if (!description) return null;
  const cleaned = cleanWhitespace(description.replace(/<[^>]+>/g, ' '));
  return cleaned ? cleaned.slice(0, MAX_DESCRIPTION_LENGTH) : null;
}

function normalizeCurrency(currency: string): string {
  const upper = currency.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(upper) ? upper : 'BRL';
}

export function buildSearchText(parts: Array<string | null | undefined>): string {
  return normalizeText(parts.filter(Boolean).join(' '));
}

/** Aplica todas as regras determinísticas. Lança ProductNormalizationError se o item é inválido. */
export function normalizeProduct(product: ScrapedProduct): NormalizedProduct {
  const externalId = product.externalId?.trim();
  if (!externalId) throw new ProductNormalizationError('', 'Missing externalId');

  const fail = (reason: string) => new ProductNormalizationError(externalId, reason);

  const name = normalizeName(product.name ?? '');
  if (!name) throw fail('Missing name');

  const price = parsePrice(product.price);
  if (price === null || price <= 0) throw fail(`Invalid price: ${String(product.price)}`);

  const parsedOriginal = parsePrice(product.originalPrice);
  const originalPrice = parsedOriginal !== null && parsedOriginal > price ? parsedOriginal : null;

  const productUrl = normalizeUrl(product.productUrl);
  if (!productUrl) throw fail(`Invalid productUrl: ${product.productUrl}`);

  const images = [product.imageUrl, ...(product.images ?? [])]
    .map((url) => normalizeUrl(url))
    .filter((url): url is string => url !== null)
    .filter((url, index, all) => all.indexOf(url) === index)
    .slice(0, MAX_IMAGES);

  const description = normalizeDescription(product.description);
  const brand = product.brand ? cleanWhitespace(product.brand) || null : null;
  const gender = normalizeGender(
    product.gender,
    name,
    product.category,
    description?.slice(0, 200),
  );
  const color = normalizeColor(product.color, name);
  const categorySlug = normalizeCategory(name, product.category);
  const size = product.size ? cleanWhitespace(product.size).toUpperCase() || null : null;

  return {
    externalId,
    name,
    slug: slugify(name),
    description,
    brand,
    categorySlug,
    gender,
    color,
    size,
    price,
    originalPrice,
    currency: normalizeCurrency(product.currency ?? 'BRL'),
    imageUrl: images[0] ?? null,
    images,
    productUrl,
    available: product.available === true,
    // O slug de categoria fica de fora: "calcados" faria "calca" casar com sapatos.
    searchText: buildSearchText([name, brand, color, gender]),
    rawData: product.rawData ?? null,
  };
}
