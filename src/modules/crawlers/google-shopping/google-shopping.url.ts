import { COUNTRY_CODE, GOOGLE_DOMAIN, LANGUAGE_TAG } from '../../../shared/utils/market.js';
import { cleanWhitespace } from '../../../shared/utils/text.js';
import { LIVE_SEARCH_MAX_QUERY_LENGTH } from '../crawler.types.js';
import { GoogleShoppingInvalidRequestError } from './google-shopping.errors.js';
import type { GoogleShoppingMarket, GoogleShoppingRequest } from './google-shopping.types.js';

const SERPAPI_SEARCH_URL = 'https://serpapi.com/search.json';

/**
 * Valida e limpa termo + mercado. Toda URL sai daqui: nada que o cliente mande vira host ou
 * caminho — só valores de query string, codificados por URLSearchParams.
 */
export function buildRequest(query: string, market: GoogleShoppingMarket): GoogleShoppingRequest {
  const cleaned = cleanWhitespace(query);
  if (!cleaned) throw new GoogleShoppingInvalidRequestError('query is empty');
  if (cleaned.length > LIVE_SEARCH_MAX_QUERY_LENGTH) {
    throw new GoogleShoppingInvalidRequestError('query is too long');
  }
  if (!GOOGLE_DOMAIN.test(market.domain)) {
    throw new GoogleShoppingInvalidRequestError('domain is not a Google domain');
  }
  if (!COUNTRY_CODE.test(market.country))
    throw new GoogleShoppingInvalidRequestError('bad country');
  if (!LANGUAGE_TAG.test(market.language))
    throw new GoogleShoppingInvalidRequestError('bad language');
  return { query: cleaned, market };
}

/** Página de resultados da aba Shopping (udm=28) no domínio configurado. */
export function buildSearchUrl({ query, market }: GoogleShoppingRequest): URL {
  const url = new URL(`https://www.${market.domain}/search`);
  url.searchParams.set('q', query);
  url.searchParams.set('udm', '28');
  url.searchParams.set('hl', market.language);
  url.searchParams.set('gl', market.country.toLowerCase());
  return url;
}

/** Engine google_shopping da SerpApi. A URL contém a API key — nunca logar. */
export function buildSerpApiUrl({ query, market }: GoogleShoppingRequest, apiKey: string): URL {
  const url = new URL(SERPAPI_SEARCH_URL);
  url.searchParams.set('engine', 'google_shopping');
  url.searchParams.set('q', query);
  url.searchParams.set('google_domain', market.domain);
  url.searchParams.set('hl', market.language.toLowerCase());
  url.searchParams.set('gl', market.country.toLowerCase());
  url.searchParams.set('api_key', apiKey);
  return url;
}
