import type { Crawler } from '../crawler.interface.js';
import type { BrowserPool } from '../shared/browser.js';
import type { CrawlerLogger } from '../shared/crawler-context.js';
import { GoogleShoppingBrowserFetcher } from './google-shopping.browser-fetcher.js';
import type { GoogleShoppingConfig } from './google-shopping.config.js';
import { GoogleShoppingUnavailableError } from './google-shopping.errors.js';
import { parseGoogleShoppingHtml } from './google-shopping.html-parser.js';
import { GoogleShoppingProvider } from './google-shopping.provider.js';
import { parseSerpApiResponse } from './google-shopping.serpapi-parser.js';
import { GoogleShoppingSerpApiFetcher } from './google-shopping.serpapi-fetcher.js';
import type { FetchResult, GoogleShoppingFetcher } from './google-shopping.types.js';

export {
  googleShoppingConfigFromEnv,
  type GoogleShoppingConfig,
} from './google-shopping.config.js';
export { GOOGLE_SHOPPING_SOURCE, GoogleShoppingProvider } from './google-shopping.provider.js';

/** Crawler com busca ao vivo garantida (o que este provider é). */
export type LiveSearchCrawler = Crawler & Required<Pick<Crawler, 'liveSearch' | 'close'>>;

export interface GoogleShoppingDeps {
  config: GoogleShoppingConfig;
  browser: BrowserPool;
  userAgent: string;
  logger?: CrawlerLogger;
  /** Só pra testes do fetcher da SerpApi. */
  fetchFn?: typeof fetch;
}

/**
 * Monta o provider com o par fetcher + parser escolhido em GOOGLE_SHOPPING_FETCHER.
 * Único lugar que sabe que existem vários jeitos de buscar no Google Shopping.
 */
export function createGoogleShoppingProvider(deps: GoogleShoppingDeps): LiveSearchCrawler {
  const { config, logger } = deps;
  switch (config.fetcher) {
    case 'serpapi':
      return new GoogleShoppingProvider({
        fetcher: new GoogleShoppingSerpApiFetcher({
          // Obrigatória com fetcher=serpapi (config/env.ts barra no startup).
          apiKey: config.serpApiKey ?? '',
          timeoutMs: config.navigationTimeoutMs,
          fetchFn: deps.fetchFn,
        }),
        parse: parseSerpApiResponse,
        config,
        logger,
      });
    case 'browser':
      return new GoogleShoppingProvider({
        fetcher: new GoogleShoppingBrowserFetcher({
          browser: deps.browser,
          userAgent: deps.userAgent,
          navigationTimeoutMs: config.navigationTimeoutMs,
          selectorTimeoutMs: config.selectorTimeoutMs,
        }),
        parse: parseGoogleShoppingHtml,
        config,
        logger,
        // Pool compartilhado com outros crawlers; fechar de novo é inofensivo.
        close: () => deps.browser.close(),
      });
    case 'disabled':
      return new GoogleShoppingProvider({
        fetcher: disabledFetcher,
        parse: () => [],
        // Responde na hora, sem esperar o intervalo entre buscas.
        config: { ...config, requestDelayMs: 0 },
        logger,
      });
  }
}

/** GOOGLE_SHOPPING_FETCHER=disabled: responde indisponível sem acessar nada. */
const disabledFetcher: GoogleShoppingFetcher<never> = {
  name: 'disabled',
  fetch(): Promise<FetchResult<never>> {
    return Promise.reject(
      new GoogleShoppingUnavailableError('disabled by GOOGLE_SHOPPING_FETCHER=disabled'),
    );
  },
};
