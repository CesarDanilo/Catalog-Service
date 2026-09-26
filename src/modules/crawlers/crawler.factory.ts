import { disabledSources } from '../../config/env.js';
import { AmazonCrawler } from './amazon/amazon.crawler.js';
import { CACrawler } from './ca/ca.crawler.js';
import type { Crawler } from './crawler.interface.js';
import { CrawlerRegistry } from './crawler.registry.js';
import { RennerCrawler } from './renner/renner.crawler.js';
import type { CrawlerContext } from './shared/crawler-context.js';

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
    new CACrawler(context.createHttpClient()),
    new AmazonCrawler(),
  ];
  const registry = new CrawlerRegistry();
  for (const crawler of crawlers) {
    if (!disabled.has(crawler.source)) registry.register(crawler);
  }
  return registry;
}
