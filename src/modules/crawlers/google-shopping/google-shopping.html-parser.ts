import * as cheerio from 'cheerio';
import type { Cheerio, CheerioAPI } from 'cheerio';
// Só o tipo do nó do DOM (dependência do próprio cheerio); some no build.
import type { AnyNode } from 'domhandler';
import { GoogleShoppingBlockedError, GoogleShoppingParseError } from './google-shopping.errors.js';
import { BLOCKED_TEXT, SELECTORS } from './google-shopping.selectors.js';
import type { RawGoogleShoppingProduct } from './google-shopping.types.js';
import {
  detectCurrency,
  findPriceText,
  parseCount,
  parseRating,
  toHttpUrl,
  toPrice,
  toText,
} from './google-shopping.values.js';

export interface GoogleShoppingHtmlPayload {
  html: string;
  /** Origem da página (ex.: https://www.google.com.br), pra resolver links relativos. */
  baseUrl: string;
}

type Card = Cheerio<AnyNode>;

/**
 * HTML da página de resultados -> RawGoogleShoppingProduct[].
 * - página de bloqueio (CAPTCHA) -> GoogleShoppingBlockedError;
 * - página de resultados sem produtos (aviso de "nenhum resultado") -> [];
 * - qualquer outra coisa que não dá pra interpretar -> GoogleShoppingParseError.
 * Campo que falta num cartão vira `undefined`, sem derrubar o resto.
 */
export function parseGoogleShoppingHtml({
  html,
  baseUrl,
}: GoogleShoppingHtmlPayload): RawGoogleShoppingProduct[] {
  if (!html.trim()) throw new GoogleShoppingParseError('empty HTML');
  const $ = cheerio.load(html);

  if (isBlockedPage($)) throw new GoogleShoppingBlockedError('CAPTCHA / unusual traffic page');

  const cards = findCards($);
  if (cards.length === 0) {
    if (hasAny($, SELECTORS.noResults)) return [];
    const reason = hasAny($, SELECTORS.resultsContainer)
      ? 'results page without product cards (layout may have changed)'
      : 'not a Google Shopping results page';
    throw new GoogleShoppingParseError(reason);
  }

  return cards.map((card, index) => parseCard(card, index + 1, baseUrl));
}

export function isBlockedPage($: CheerioAPI): boolean {
  if (hasAny($, SELECTORS.blocked)) return true;
  const text = $('body').text();
  return BLOCKED_TEXT.some((pattern) => pattern.test(text));
}

function parseCard(card: Card, position: number, baseUrl: string): RawGoogleShoppingProduct {
  const title = extractTitle(card);
  return {
    position,
    externalId: extractExternalId(card),
    title,
    price: extractPrice(card, title),
    currency: extractCurrency(card, title),
    imageUrl: extractImage(card),
    productUrl: extractProductUrl(card, baseUrl),
    seller: extractSeller(card),
    rating: extractRating(card),
    reviewCount: extractReviewCount(card),
  };
}

/** Cartões do primeiro seletor que achar algum, sem os aninhados dentro de outro cartão. */
function findCards($: CheerioAPI): Card[] {
  for (const selector of SELECTORS.cards) {
    const found = $(selector).filter((_, el) => $(el).parents(selector).length === 0);
    if (found.length > 0) return found.toArray().map((el) => $(el));
  }
  return [];
}

function hasAny($: CheerioAPI, selectors: readonly string[]): boolean {
  return $(selectors.join(', ')).length > 0;
}

/** Texto do primeiro elemento (na ordem dos seletores) que tiver conteúdo. */
function firstText(card: Card, selectors: readonly string[]): string | undefined {
  for (const selector of selectors) {
    for (const el of card.find(selector).toArray()) {
      const text = toText(card.find(el).text());
      if (text) return text;
    }
  }
  return undefined;
}

/** Primeiro atributo `aria-label` (na ordem dos seletores) que não estiver vazio. */
function firstAriaLabel(card: Card, selectors: readonly string[]): string | undefined {
  for (const selector of selectors) {
    const label = toText(card.find(selector).first().attr('aria-label'));
    if (label) return label;
  }
  return undefined;
}

export function extractTitle(card: Card): string | undefined {
  return (
    firstText(card, SELECTORS.title) ??
    toText(card.find('a[aria-label]').first().attr('aria-label')) ??
    toText(card.find('img[alt]').first().attr('alt'))
  );
}

export function extractPriceText(card: Card, title?: string): string | undefined {
  const text = toText(card.text()) ?? '';
  // O título pode conter números ("Kit 3 Camisetas"); o preço é procurado no resto do cartão.
  return findPriceText(title ? text.replace(title, ' ') : text);
}

export function extractPrice(card: Card, title?: string): number | undefined {
  return toPrice(extractPriceText(card, title));
}

/** Moeda pelo símbolo do preço ("R$" -> BRL); sem símbolo claro, undefined. */
export function extractCurrency(card: Card, title?: string): string | undefined {
  return detectCurrency(extractPriceText(card, title));
}

/** Primeira imagem com URL http(s) (miniaturas inline em data: são ignoradas). */
export function extractImage(card: Card): string | undefined {
  for (const img of card.find('img').toArray()) {
    const $img = card.find(img);
    const url = toHttpUrl($img.attr('src')) ?? toHttpUrl($img.attr('data-src'));
    if (url) return url;
  }
  return undefined;
}

/** Primeiro link do cartão; redirecionamentos do Google (/url?q=...) são desembrulhados. */
export function extractProductUrl(card: Card, baseUrl: string): string | undefined {
  for (const anchor of card.find('a[href]').toArray()) {
    const url = toHttpUrl(card.find(anchor).attr('href'), baseUrl);
    if (!url) continue;
    const parsed = new URL(url);
    const target =
      parsed.pathname === '/url'
        ? toHttpUrl(parsed.searchParams.get('q') ?? parsed.searchParams.get('url'))
        : url;
    if (target) return target;
  }
  return undefined;
}

export function extractSeller(card: Card): string | undefined {
  return (
    toText(card.find('[data-merchant-name]').first().attr('data-merchant-name')) ??
    firstText(card, SELECTORS.seller)
  );
}

export function extractRating(card: Card): number | undefined {
  const label = firstAriaLabel(card, SELECTORS.rating);
  if (label) return parseRating(label);
  const text = firstText(card, SELECTORS.rating);
  return text ? parseRating(text) : undefined;
}

export function extractReviewCount(card: Card): number | undefined {
  const label = firstAriaLabel(card, SELECTORS.reviewCount);
  if (label) return parseCount(label);
  const text = firstText(card, SELECTORS.reviewCount);
  if (text) return parseCount(text);
  // Formato comum ao lado das estrelas: "(352)" / "(1,2 mil)".
  const inParens = /\((\d[\d.,]*\s*(?:mil|k)?)\)/i.exec(card.text())?.[1];
  return inParens ? parseCount(inParens) : undefined;
}

export function extractExternalId(card: Card): string | undefined {
  const attr =
    toText(card.attr('data-docid')) ?? toText(card.find('[data-docid]').first().attr('data-docid'));
  if (attr) return attr;
  const href = card.find('a[href*="/shopping/product/"]').first().attr('href') ?? '';
  return /\/shopping\/product\/(\d+)/.exec(href)?.[1];
}
