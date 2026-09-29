import {
  GoogleShoppingParseError,
  GoogleShoppingUnavailableError,
} from './google-shopping.errors.js';
import {
  serpApiShoppingResponseSchema,
  serpApiShoppingResultSchema,
  type SerpApiShoppingResult,
} from './google-shopping.schemas.js';
import type { RawGoogleShoppingProduct } from './google-shopping.types.js';
import {
  detectCurrency,
  parseCount,
  parseRating,
  toHttpUrl,
  toPrice,
  toText,
} from './google-shopping.values.js';

/** A SerpApi responde 200 com este `error` quando a busca não tem resultados. */
const NO_RESULTS = /hasn't returned any results/i;

/**
 * JSON da SerpApi (engine google_shopping) -> RawGoogleShoppingProduct[].
 * Busca sem resultados -> []; erro reportado pela SerpApi -> indisponível;
 * JSON que não é uma resposta da SerpApi -> GoogleShoppingParseError.
 */
export function parseSerpApiResponse(payload: unknown): RawGoogleShoppingProduct[] {
  const parsed = serpApiShoppingResponseSchema.safeParse(payload);
  if (!parsed.success) throw new GoogleShoppingParseError('not a SerpApi response object');
  const response = parsed.data;

  if (response.error) {
    if (NO_RESULTS.test(response.error)) return [];
    throw new GoogleShoppingUnavailableError(`serpapi: ${response.error.slice(0, 200)}`);
  }

  const results =
    response.shopping_results ??
    response.categorized_shopping_results?.flatMap((group) => group.shopping_results ?? []);
  if (!results) {
    if (response.search_metadata) return [];
    throw new GoogleShoppingParseError('SerpApi response without results or metadata');
  }

  return results.map((entry, index) => {
    // Os campos são tolerantes; só um item que nem é objeto falha aqui (vira item vazio).
    const item = serpApiShoppingResultSchema.safeParse(entry);
    return item.success ? toRawProduct(item.data, index + 1) : { position: index + 1 };
  });
}

function toRawProduct(
  item: SerpApiShoppingResult,
  fallbackPosition: number,
): RawGoogleShoppingProduct {
  return {
    position: item.position ?? fallbackPosition,
    externalId: item.product_id === undefined ? undefined : String(item.product_id),
    title: toText(item.title),
    price: toPrice(item.extracted_price ?? item.price),
    currency: detectCurrency(item.price),
    imageUrl: toHttpUrl(item.thumbnail),
    productUrl: toHttpUrl(item.product_link) ?? toHttpUrl(item.link),
    seller: toText(item.source),
    rating: parseRating(item.rating),
    reviewCount: parseCount(item.reviews),
  };
}
