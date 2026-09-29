import { CrawlerError } from '../../../shared/errors/app-error.js';
import {
  ConcurrencyLimiter,
  LimiterQueueFullError,
} from '../../../shared/utils/concurrency-limiter.js';
import { retryWithBackoff } from '../../../shared/utils/retry.js';
import { normalizeSearchQuery } from '../../../shared/utils/text.js';
import type { Crawler } from '../crawler.interface.js';
import {
  DEFAULT_CRAWL_LIMIT,
  type CrawlItem,
  type CrawlOptions,
  type LiveSearchParams,
  type LiveSearchResult,
  type ScrapedProduct,
} from '../crawler.types.js';
import type { CrawlerLogger } from '../shared/crawler-context.js';
import type { GoogleShoppingConfig } from './google-shopping.config.js';
import {
  GoogleShoppingTimeoutError,
  GoogleShoppingUnavailableError,
  toGoogleShoppingError,
  type GoogleShoppingScraperError,
} from './google-shopping.errors.js';
import { mapGoogleShoppingProduct } from './google-shopping.mapper.js';
import type {
  GoogleShoppingFetcher,
  GoogleShoppingParser,
  GoogleShoppingRequest,
  StageTimings,
} from './google-shopping.types.js';
import { buildRequest } from './google-shopping.url.js';

export const GOOGLE_SHOPPING_SOURCE = 'google-shopping';

/** Máximo de caracteres da busca que vão pro log. */
const LOGGED_QUERY_LENGTH = 100;
const RETRY_BASE_DELAY_MS = 1_000;

export interface GoogleShoppingProviderDeps<TPayload> {
  /** Obtém os dados brutos (navegador, API...). */
  fetcher: GoogleShoppingFetcher<TPayload>;
  /** Interpreta os dados brutos do MESMO fetcher. */
  parse: GoogleShoppingParser<TPayload>;
  config: Pick<
    GoogleShoppingConfig,
    | 'defaultMarket'
    | 'defaultCurrency'
    | 'maxConcurrency'
    | 'maxQueue'
    | 'requestDelayMs'
    | 'timeoutMs'
    | 'maxAttempts'
    | 'maxProducts'
  >;
  logger?: CrawlerLogger;
  /** Libera o que o fetcher usa (ex.: o Chromium) no desligamento. */
  close?: () => Promise<void>;
}

/**
 * Google Shopping como fonte do catálogo. Só orquestra:
 *   fila (concorrência + intervalo) -> fetcher -> parser -> mapper -> ScrapedProduct[]
 * com prazo total, retry só pra falhas passageiras e log de cada busca.
 * Não conhece HTML, SerpApi, HTTP de entrada, cache nem banco.
 */
export class GoogleShoppingProvider<TPayload> implements Crawler {
  readonly source = GOOGLE_SHOPPING_SOURCE;
  private readonly limiter: ConcurrencyLimiter;

  constructor(private readonly deps: GoogleShoppingProviderDeps<TPayload>) {
    this.limiter = new ConcurrencyLimiter({
      maxConcurrent: deps.config.maxConcurrency,
      maxQueue: deps.config.maxQueue,
      minIntervalMs: deps.config.requestDelayMs,
    });
  }

  async liveSearch(params: LiveSearchParams): Promise<LiveSearchResult> {
    const { config } = this.deps;
    const request = buildRequest(params.query, {
      ...config.defaultMarket,
      country: params.country ?? config.defaultMarket.country,
      language: params.language ?? config.defaultMarket.language,
    });

    const startedAt = Date.now();
    const deadline = AbortSignal.timeout(config.timeoutMs);
    const signal = params.signal ? AbortSignal.any([params.signal, deadline]) : deadline;
    const log = {
      provider: this.source,
      fetcher: this.deps.fetcher.name,
      query: normalizeSearchQuery(request.query).slice(0, LOGGED_QUERY_LENGTH),
      country: request.market.country,
      language: request.market.language,
    };

    try {
      const { products, skipped, timings } = await raceWithSignal(
        this.limiter.run(() => this.fetchWithRetry(request, signal), signal),
        signal,
      );
      this.deps.logger?.info(
        {
          ...log,
          status: 'success',
          durationMs: Date.now() - startedAt,
          resultCount: products.length,
          skipped,
          timings,
        },
        'google shopping search',
      );
      return {
        products,
        country: request.market.country,
        language: request.market.language,
      };
    } catch (caught) {
      const error = this.classify(caught, deadline);
      const status = error.code === 'GOOGLE_SHOPPING_BLOCKED' ? 'blocked' : 'error';
      this.deps.logger?.warn(
        {
          ...log,
          status,
          durationMs: Date.now() - startedAt,
          errorCode: error.code,
          reason: error.reason,
        },
        'google shopping search failed',
      );
      throw error;
    }
  }

  /** Mesmo pipeline da busca ao vivo, no formato do CrawlRunner (útil se um dia persistir). */
  async *search(query: string, options: CrawlOptions = {}): AsyncIterable<CrawlItem> {
    const { products } = await this.liveSearch({ query, signal: options.signal });
    for (const product of products.slice(0, options.limit ?? DEFAULT_CRAWL_LIMIT)) {
      yield { ok: true, product };
    }
  }

  // eslint-disable-next-line require-yield -- não há catálogo pra sincronizar, só busca por termo
  async *crawl(): AsyncIterable<CrawlItem> {
    throw new CrawlerError('Google Shopping has no catalog to sync; use search', false);
  }

  async close(): Promise<void> {
    await this.deps.close?.();
  }

  private fetchWithRetry(request: GoogleShoppingRequest, signal: AbortSignal) {
    return retryWithBackoff((attempt) => this.fetchOnce(request, signal, attempt), {
      maxAttempts: this.deps.config.maxAttempts,
      baseDelayMs: RETRY_BASE_DELAY_MS,
      signal,
      // Bloqueio/CAPTCHA, parse e configuração são retryable=false: nunca repetem.
      shouldRetry: (error) => !signal.aborted && toGoogleShoppingError(error).retryable,
      onRetry: (error, attempt, delayMs) =>
        this.deps.logger?.warn(
          {
            provider: this.source,
            attempt,
            delayMs,
            errorCode: toGoogleShoppingError(error).code,
          },
          'google shopping transient failure, retrying',
        ),
    });
  }

  private async fetchOnce(request: GoogleShoppingRequest, signal: AbortSignal, attempt: number) {
    const { payload, timings: fetchTimings } = await this.deps.fetcher.fetch(request, signal);

    const parseStart = Date.now();
    const raws = this.deps.parse(payload);
    const parseMs = Date.now() - parseStart;

    const mapStart = Date.now();
    const products: ScrapedProduct[] = [];
    let skipped = 0;
    for (const raw of raws) {
      const item = mapGoogleShoppingProduct(raw, this.deps.config.defaultCurrency);
      if (item.ok) products.push(item.product);
      else skipped++;
    }
    const timings: StageTimings = {
      ...fetchTimings,
      parseMs,
      normalizeMs: Date.now() - mapStart,
      attempt,
    };
    return { products: products.slice(0, this.deps.config.maxProducts), skipped, timings };
  }

  private classify(error: unknown, deadline: AbortSignal): GoogleShoppingScraperError {
    if (deadline.aborted) return new GoogleShoppingTimeoutError('overall search timeout');
    if (error instanceof LimiterQueueFullError) {
      return new GoogleShoppingUnavailableError('too many concurrent searches (queue full)');
    }
    return toGoogleShoppingError(error);
  }
}

/** Rejeita assim que o signal abortar, mesmo que a promessa não pare sozinha. */
function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}
