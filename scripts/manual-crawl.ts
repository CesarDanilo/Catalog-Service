/**
 * Teste MANUAL de um crawler contra a loja real (requer internet). Não grava no banco.
 *
 *   npm run crawl:manual -- <source> crawl [limite]
 *   npm run crawl:manual -- <source> search "<termo>" [limite]
 *
 * Ex.: npm run crawl:manual -- ca search "camisa preta" 3
 */
import { createCrawlerRegistry } from '../src/modules/crawlers/crawler.factory.js';
import { normalizeProduct } from '../src/modules/crawlers/normalizer/product.normalizer.js';
import { createCrawlerContext } from '../src/modules/crawlers/shared/crawler-context.js';

async function main() {
  const [source, mode = 'crawl', ...rest] = process.argv.slice(2);
  const query = mode === 'search' ? rest[0] : undefined;
  const limit = Number((mode === 'search' ? rest[1] : rest[0]) ?? 3);

  const registry = createCrawlerRegistry(createCrawlerContext());
  const crawler = source ? registry.get(source) : undefined;
  if (!crawler || (mode === 'search' && !query)) {
    console.error(
      `Uso: npm run crawl:manual -- <${registry.list().join('|')}> crawl|search [termo] [limite]`,
    );
    process.exit(1);
  }

  const started = Date.now();
  const items = query ? crawler.search(query, { limit }) : crawler.crawl({ limit });
  let ok = 0;
  let failed = 0;

  try {
    for await (const item of items) {
      if (!item.ok) {
        failed++;
        console.log(`✗ ${item.reference}: ${item.error}`);
        continue;
      }
      try {
        const { rawData: _raw, images, description, ...product } = normalizeProduct(item.product);
        ok++;
        console.log(
          '✓',
          JSON.stringify(
            { ...product, images: images.length, description: description?.slice(0, 80) },
            null,
            2,
          ),
        );
      } catch (error) {
        failed++;
        console.log(`✗ ${item.product.externalId}: ${(error as Error).message}`);
      }
    }
  } finally {
    await registry.closeAll();
  }
  console.log(`\n${ok} ok, ${failed} falhas em ${Date.now() - started}ms`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
