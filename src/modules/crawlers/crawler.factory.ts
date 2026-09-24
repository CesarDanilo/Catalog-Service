import { AmazonCrawler } from './amazon/amazon.crawler.js';
import { CACrawler } from './ca/ca.crawler.js';
import { CrawlerRegistry } from './crawler.registry.js';
import { RennerCrawler } from './renner/renner.crawler.js';
import type { CrawlerContext } from './shared/crawler-context.js';

/** Único ponto que conhece todas as lojas. Para adicionar uma loja, registre-a aqui. */
export function createCrawlerRegistry(context: CrawlerContext): CrawlerRegistry {
  return new CrawlerRegistry()
    .register(
      new RennerCrawler({
        http: context.createHttpClient(),
        browser: context.browser,
        userAgent: context.userAgent,
        timeoutMs: context.timeoutMs,
      }),
    )
    .register(new CACrawler(context.createHttpClient()))
    .register(new AmazonCrawler());
}
