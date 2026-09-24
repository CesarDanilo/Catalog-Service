import { env } from '../../../config/env.js';
import { BrowserPool } from './browser.js';
import { HttpClient, type HttpClientOptions } from './http-client.js';

/** Dependências de infraestrutura que os crawlers recebem (facilita testes com fakes). */
export interface CrawlerContext {
  createHttpClient(overrides?: Partial<HttpClientOptions>): HttpClient;
  browser: BrowserPool;
  userAgent: string;
  timeoutMs: number;
}

export function createCrawlerContext(): CrawlerContext {
  return {
    createHttpClient: (overrides = {}) =>
      new HttpClient({
        userAgent: env.CRAWLER_USER_AGENT,
        timeoutMs: env.CRAWLER_TIMEOUT,
        maxRetries: env.CRAWLER_MAX_RETRIES,
        minDelayMs: env.CRAWLER_REQUEST_DELAY,
        ...overrides,
      }),
    browser: new BrowserPool(),
    userAgent: env.CRAWLER_USER_AGENT,
    timeoutMs: env.CRAWLER_TIMEOUT,
  };
}
