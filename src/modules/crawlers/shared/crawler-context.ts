import { env } from '../../../config/env.js';
import { createLogger } from '../../../shared/utils/logger.js';
import { BrowserPool } from './browser.js';
import { HttpClient, type HttpClientOptions } from './http-client.js';

/** Logger estruturado que os crawlers recebem (pino satisfaz; testes passam um fake). */
export interface CrawlerLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

/** Dependências de infraestrutura que os crawlers recebem (facilita testes com fakes). */
export interface CrawlerContext {
  createHttpClient(overrides?: Partial<HttpClientOptions>): HttpClient;
  browser: BrowserPool;
  userAgent: string;
  timeoutMs: number;
  logger?: CrawlerLogger;
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
    logger: createLogger('crawlers'),
  };
}
