import { disabledSources, env } from '../../config/env.js';
import { AmazonCrawler } from './amazon/amazon.crawler.js';
import type { Crawler } from './crawler.interface.js';
import { CrawlerRegistry } from './crawler.registry.js';
import {
  createGoogleShoppingProvider,
  googleShoppingConfigFromEnv,
} from './google-shopping/index.js';
import { RennerCrawler } from './renner/renner.crawler.js';
import type { CrawlerContext } from './shared/crawler-context.js';
import { VtexCrawler } from './vtex/vtex.crawler.js';
import { VTEX_STORES } from './vtex/vtex.stores.js';

/**
 * Único ponto que conhece todas as lojas. Para adicionar uma loja, registre-a aqui.
 * Lojas em `disabled` (CRAWLER_DISABLED_SOURCES) ficam de fora do registro.
 */
export function createCrawlerRegistry(
  context: CrawlerContext,
  disabled: ReadonlySet<string> = disabledSources,
): CrawlerRegistry {
  const crawlers: Crawler[] = [
    new RennerCrawler({
      http: context.createHttpClient(),
      browser: context.browser,
      userAgent: context.userAgent,
      timeoutMs: context.timeoutMs,
    }),
    // Cada loja VTEX com o próprio HttpClient: o intervalo mínimo entre requisições é por loja.
    ...VTEX_STORES.map((store) => new VtexCrawler(context.createHttpClient(), store)),
    new AmazonCrawler(),
    createGoogleShoppingProvider({
      config: googleShoppingConfigFromEnv(env),
      browser: context.browser,
      userAgent: context.userAgent,
      logger: context.logger,
    }),
  ];
  const registry = new CrawlerRegistry();
  for (const crawler of crawlers) {
    if (!disabled.has(crawler.source)) registry.register(crawler);
  }
  return registry;
}
