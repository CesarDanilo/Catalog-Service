import { parsePrice } from '../../../shared/utils/price.js';
import { cleanWhitespace } from '../../../shared/utils/text.js';

/**
 * Conversões de texto em valor, comuns aos parsers de HTML e da SerpApi.
 * Todas devolvem `undefined` quando o texto não permite uma leitura segura — nunca chutam.
 */

const CURRENCY_SYMBOLS: Array<[RegExp, string]> = [
  [/R\$/, 'BRL'],
  [/US\$/, 'USD'],
  [/€/, 'EUR'],
  [/£/, 'GBP'],
];

/** "R$ 49,90" -> "BRL". "$ 10" (símbolo ambíguo) -> undefined. */
export function detectCurrency(text: string | undefined): string | undefined {
  if (!text) return undefined;
  return CURRENCY_SYMBOLS.find(([pattern]) => pattern.test(text))?.[1];
}

/** Primeiro preço com símbolo de moeda no texto: "de R$ 99,90 por R$ 49,90" -> "R$ 99,90". */
const PRICE_IN_TEXT = /(?:R\$|US\$|€|£|\$)\s?\d[\d.,]*/;

export function findPriceText(text: string): string | undefined {
  return PRICE_IN_TEXT.exec(text)?.[0];
}

export function toPrice(value: unknown): number | undefined {
  const price = parsePrice(value);
  return price === null || price === 0 ? undefined : price;
}

/** Nota de 0 a 5: "4,7" / "4.7" / "Avaliação 4,7 de 5". */
export function parseRating(value: unknown): number | undefined {
  const number =
    typeof value === 'number'
      ? value
      : Number(/\d+(?:[.,]\d+)?/.exec(String(value ?? ''))?.[0]?.replace(',', '.'));
  return Number.isFinite(number) && number >= 0 && number <= 5 ? number : undefined;
}

/** Quantidade: 352 / "(352)" / "1.234 avaliações" / "1,2 mil" / "2.5K". */
export function parseCount(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 ? value : undefined;
  }
  const match = /(\d+(?:[.,]\d+)*)\s*(mil|k)?\b/i.exec(String(value ?? ''));
  if (!match?.[1]) return undefined;
  const [, digits, suffix] = match;
  if (suffix) {
    const base = Number(digits.replace(',', '.'));
    return Number.isFinite(base) ? Math.round(base * 1000) : undefined;
  }
  const count = Number(digits.replace(/[.,]/g, ''));
  return Number.isSafeInteger(count) ? count : undefined;
}

/** Só URLs http(s) absolutas; qualquer outro esquema (javascript:, data:...) é descartado. */
export function toHttpUrl(value: unknown, base?: string): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim(), base);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function toText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return cleanWhitespace(value) || undefined;
}
