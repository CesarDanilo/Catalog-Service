/**
 * Teste REAL e opcional do Google Shopping (nunca roda no `npm test` nem no CI).
 *
 *   npm run test:google-shopping                          # "camiseta preta", fetcher do .env
 *   npm run test:google-shopping -- --fetcher=browser "tenis masculino" "vestido feminino"
 *   npm run test:google-shopping -- --fetcher=serpapi     # precisa GOOGLE_SHOPPING_SERPAPI_KEY
 *
 * Consultas em sequência, com o intervalo configurado entre elas. Se o Google bloquear
 * (CAPTCHA), imprime BLOCKED e PARA — não tenta de novo nem contorna.
 * Saída: 0 = PASS, 1 = FAIL, 2 = BLOCKED.
 */
import { env } from '../src/config/env.js';
import type { ScrapedProduct } from '../src/modules/crawlers/crawler.types.js';
import {
  createGoogleShoppingProvider,
  googleShoppingConfigFromEnv,
  type GoogleShoppingConfig,
} from '../src/modules/crawlers/google-shopping/index.js';
import { BrowserPool } from '../src/modules/crawlers/shared/browser.js';
import { AppError } from '../src/shared/errors/app-error.js';

const MIN_PRODUCTS = 5;
const FIELDS = ['imageUrl', 'seller', 'rating', 'reviewCount'] as const;

type Status = 'PASS' | 'FAIL' | 'BLOCKED';

function parseArgs(argv: string[]) {
  const fetcherArg = argv.find((arg) => arg.startsWith('--fetcher='))?.split('=')[1];
  const queries = argv.filter((arg) => !arg.startsWith('--'));
  const fetcher = (fetcherArg ?? env.GOOGLE_SHOPPING_FETCHER) as GoogleShoppingConfig['fetcher'];
  if (!['serpapi', 'browser'].includes(fetcher)) {
    console.error(
      'Use --fetcher=browser ou --fetcher=serpapi (ou GOOGLE_SHOPPING_FETCHER no .env).',
    );
    process.exit(1);
  }
  if (fetcher === 'serpapi' && !env.GOOGLE_SHOPPING_SERPAPI_KEY) {
    console.error('GOOGLE_SHOPPING_SERPAPI_KEY não configurada.');
    process.exit(1);
  }
  return { fetcher, queries: queries.length > 0 ? queries : ['camiseta preta'] };
}

function fieldCoverage(products: ScrapedProduct[]): string {
  return FIELDS.map((field) => {
    const filled = products.filter((product) => product[field] !== undefined).length;
    return `${field} ${filled}/${products.length}`;
  }).join(', ');
}

async function runQuery(
  provider: ReturnType<typeof createGoogleShoppingProvider>,
  query: string,
): Promise<Status> {
  const startedAt = Date.now();
  console.log(`\nQuery: ${query}`);
  try {
    const { products } = await provider.liveSearch({ query });
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    const status: Status = products.length >= MIN_PRODUCTS ? 'PASS' : 'FAIL';
    console.log(`Results: ${products.length}`);
    console.log(`Fields: ${fieldCoverage(products)}`);
    console.log('Sample:');
    products.slice(0, 3).forEach((product, index) => {
      console.log(
        `  ${index + 1}. ${product.name} — ${product.currency} ${product.price}` +
          `${product.seller ? ` — ${product.seller}` : ''}`,
      );
    });
    console.log(`Duration: ${seconds}s`);
    console.log(
      `Status: ${status}${status === 'FAIL' ? ` (menos de ${MIN_PRODUCTS} produtos)` : ''}`,
    );
    return status;
  } catch (error) {
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    const code = error instanceof AppError ? error.code : 'UNKNOWN';
    const reason = (error as { reason?: string }).reason ?? (error as Error).message;
    const blocked = code === 'GOOGLE_SHOPPING_BLOCKED';
    console.log(`Duration: ${seconds}s`);
    console.log(`Status: ${blocked ? 'BLOCKED' : 'FAIL'}`);
    console.log(`Reason: ${blocked ? 'CAPTCHA / automated traffic' : code} (${reason})`);
    return blocked ? 'BLOCKED' : 'FAIL';
  }
}

async function main() {
  const { fetcher, queries } = parseArgs(process.argv.slice(2));
  const browser = new BrowserPool();
  const provider = createGoogleShoppingProvider({
    config: { ...googleShoppingConfigFromEnv(env), fetcher },
    browser,
    userAgent: env.CRAWLER_USER_AGENT,
  });

  console.log(`Google Shopping integration test (fetcher: ${fetcher})`);
  const results: Status[] = [];
  try {
    for (const query of queries) {
      const status = await runQuery(provider, query);
      results.push(status);
      if (status === 'BLOCKED') {
        console.log('\nBloqueado pelo Google: parando as consultas restantes (sem contornar).');
        break;
      }
    }
  } finally {
    await provider.close();
    await browser.close();
  }

  if (results.includes('BLOCKED')) process.exit(2);
  process.exit(results.every((status) => status === 'PASS') ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error('Unexpected failure', error);
  process.exit(1);
});
