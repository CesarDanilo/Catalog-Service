import type { BrowserPool } from '../shared/browser.js';
import { GoogleShoppingBlockedError } from './google-shopping.errors.js';
import type { GoogleShoppingHtmlPayload } from './google-shopping.html-parser.js';
import { PAGE_READY_SELECTOR } from './google-shopping.selectors.js';
import type {
  FetchResult,
  GoogleShoppingFetcher,
  GoogleShoppingRequest,
} from './google-shopping.types.js';
import { buildSearchUrl } from './google-shopping.url.js';

export interface BrowserFetcherOptions {
  browser: BrowserPool;
  userAgent: string;
  navigationTimeoutMs: number;
  selectorTimeoutMs: number;
}

/**
 * Abre a página de resultados do Google Shopping no Playwright e devolve o HTML renderizado.
 * Não interpreta produtos (isso é do parser). Navegador comum, sem disfarce de automação:
 * se o Google redirecionar pro CAPTCHA (/sorry/) ou responder 429, para na hora com
 * GoogleShoppingBlockedError — nunca tenta contornar.
 */
export class GoogleShoppingBrowserFetcher implements GoogleShoppingFetcher<GoogleShoppingHtmlPayload> {
  readonly name = 'browser';

  constructor(private readonly options: BrowserFetcherOptions) {}

  async fetch(
    request: GoogleShoppingRequest,
    signal: AbortSignal,
  ): Promise<FetchResult<GoogleShoppingHtmlPayload>> {
    const url = buildSearchUrl(request);
    const startedAt = Date.now();
    const timings: Record<string, number> = {};

    return this.options.browser.withPage(
      {
        userAgent: this.options.userAgent,
        locale: request.market.language,
        // Só o DOM interessa; as URLs das imagens continuam nos atributos.
        blockResources: ['image', 'font', 'media'],
        signal,
      },
      async (page) => {
        timings.browserMs = Date.now() - startedAt; // inclui abrir o Chromium na 1ª busca

        const navigationStart = Date.now();
        const response = await page.goto(url.href, {
          timeout: this.options.navigationTimeoutMs,
          waitUntil: 'domcontentloaded',
        });
        timings.navigationMs = Date.now() - navigationStart;
        assertNotBlocked(page.url(), response?.status());

        const extractionStart = Date.now();
        // Sem o seletor no prazo, o HTML vai assim mesmo: o parser decide (vazio, layout novo...).
        await page
          .waitForSelector(PAGE_READY_SELECTOR, { timeout: this.options.selectorTimeoutMs })
          .catch(() => undefined);
        assertNotBlocked(page.url(), undefined);
        const html = await page.content();
        timings.extractionMs = Date.now() - extractionStart;

        return { payload: { html, baseUrl: url.origin }, timings };
      },
    );
  }
}

function assertNotBlocked(finalUrl: string, status: number | undefined): void {
  if (status === 429) throw new GoogleShoppingBlockedError('HTTP 429 from Google');
  if (new URL(finalUrl).pathname.startsWith('/sorry/')) {
    throw new GoogleShoppingBlockedError('redirected to /sorry/ (CAPTCHA)');
  }
}
