import { describe, expect, it } from 'vitest';
import type { CrawlItem } from '../../src/modules/crawlers/crawler.types.js';
import { normalizeProduct } from '../../src/modules/crawlers/normalizer/product.normalizer.js';
import { RennerCrawler } from '../../src/modules/crawlers/renner/renner.crawler.js';
import {
  mapRennerProduct,
  mapRennerSearchCard,
} from '../../src/modules/crawlers/renner/renner.mapper.js';
import {
  extractProductIdFromUrl,
  parseProductLinks,
  parseRennerProductPage,
  parseSearchCards,
} from '../../src/modules/crawlers/renner/renner.parser.js';
import type { BrowserPool } from '../../src/modules/crawlers/shared/browser.js';
import { AccessDeniedError, HttpClient } from '../../src/modules/crawlers/shared/http-client.js';
import { parseSitemap } from '../../src/modules/crawlers/shared/sitemap.js';
import { fakeFetch, readFixture } from '../helpers/fixtures.js';

const BASE = 'https://www.lojasrenner.com.br';
const PRODUCT_URL = `${BASE}/p/saida-de-praia-blusa-em-trico-com-manga-ampla-branco/-/A-931612620-br.lr`;
const productHtml = readFixture('renner-product.html');
const searchHtml = readFixture('renner-search-rendered.html');
const cardsHtml = readFixture('renner-search-cards.html');

async function collect(items: AsyncIterable<CrawlItem>) {
  const result: CrawlItem[] = [];
  for await (const item of items) result.push(item);
  return result;
}

function crawler(
  fetchFn: typeof fetch,
  renderedHtml: string | ((url: string) => string) = searchHtml,
) {
  const rendered: string[] = [];
  const browser = {
    renderHtml: async (url: string) => {
      rendered.push(url);
      return typeof renderedHtml === 'function' ? renderedHtml(url) : renderedHtml;
    },
    close: async () => {},
  };
  return new RennerCrawler({
    http: new HttpClient({
      userAgent: 'test',
      timeoutMs: 1_000,
      maxRetries: 1,
      minDelayMs: 0,
      fetchFn,
    }),
    browser: browser as unknown as BrowserPool,
    userAgent: 'test',
    timeoutMs: 1_000,
  });
}

/** HTML de busca só com os cartões de índice `keep` do fixture real. */
function onlyCards(keep: number[]): string {
  const blocks = cardsHtml.split('<div class="results_item">');
  return [blocks[0], ...keep.map((i) => blocks[i + 1])].join('<div class="results_item">');
}

describe('Renner parser + mapper', () => {
  it('extrai JSON-LD e __NEXT_DATA__ da página real', () => {
    const page = parseRennerProductPage(productHtml);
    expect(page.jsonLd.name).toBe('Saída de Praia Blusa em Tricô com Manga Ampla Branco');
    expect(page.next).toMatchObject({
      productId: '931612620',
      listPrice: 139.9,
      variants: 'Branco|G',
    });
  });

  it('mapeia e normaliza o produto', () => {
    const scraped = mapRennerProduct(parseRennerProductPage(productHtml), PRODUCT_URL);
    expect(scraped).toMatchObject({
      externalId: '931612620',
      brand: 'Bossa Nossa',
      color: 'Branco',
      price: 139.9,
      currency: 'BRL',
      available: true,
    });

    const normalized = normalizeProduct(scraped);
    expect(normalized).toMatchObject({
      categorySlug: 'moda-praia',
      gender: 'feminino',
      color: 'branco',
      originalPrice: null,
      imageUrl: expect.stringMatching(/^https:\/\/img\.lojasrenner\.com\.br\//),
    });
    expect(normalized.images.length).toBeGreaterThan(1);
  });

  it('falha de forma explícita quando não há JSON-LD de produto', () => {
    expect(() => parseRennerProductPage('<html><body>captcha</body></html>')).toThrow(/JSON-LD/);
  });

  it('extrai links de produto da busca renderizada', () => {
    const links = parseProductLinks(searchHtml, BASE);
    expect(links.length).toBeGreaterThan(5);
    expect(
      links.every((link) => /^https:\/\/www\.lojasrenner\.com\.br\/p\/.+-br\.lr$/.test(link)),
    ).toBe(true);
    expect(extractProductIdFromUrl(PRODUCT_URL)).toBe('931612620');
  });

  it('lê índice e urlset de sitemap', () => {
    const index = parseSitemap(readFixture('renner-sitemap-index.xml'));
    expect(index.sitemaps[0]).toBe(`${BASE}/detail0.xml`);
    const urls = parseSitemap(readFixture('renner-sitemap-products.xml')).urls;
    expect(urls).toHaveLength(30);
  });
});

describe('RennerCrawler', () => {
  it('crawl() percorre o sitemap e visita só produtos de vestuário/calçado', async () => {
    const fetchFn = fakeFetch([
      [
        `${BASE}/sitemap.xml`,
        () =>
          new Response(
            `<sitemapindex><sitemap><loc>${BASE}/detail3.xml</loc></sitemap></sitemapindex>`,
          ),
      ],
      [`${BASE}/detail3.xml`, () => new Response(readFixture('renner-sitemap-products.xml'))],
      [/\/p\//, () => new Response(productHtml)],
    ]);
    const items = await collect(crawler(fetchFn).crawl({ limit: 3 }));

    expect(items).toHaveLength(3);
    const visited = fetchFn.calls.filter((url) => url.includes('/p/'));
    // "vichy-liftactiv-serum" e "mascara-de-limpeza" (cosméticos) não devem ser visitados.
    expect(visited.some((url) => /vichy|mascara|funko/.test(url))).toBe(false);
  });

  it('crawl() respeita Source.config.categories', async () => {
    const fetchFn = fakeFetch([
      [`${BASE}/sitemap.xml`, () => new Response(readFixture('renner-sitemap-products.xml'))],
      [/\/p\//, () => new Response(productHtml)],
    ]);
    await collect(crawler(fetchFn).crawl({ limit: 10, config: { categories: ['casacos'] } }));
    const visited = fetchFn.calls.filter((url) => url.includes('/p/'));
    expect(visited).toEqual([expect.stringContaining('cardigan-alongado-em-trico')]);
  });

  it('search() usa o browser só para links e lê produtos via HTTP', async () => {
    const fetchFn = fakeFetch([[/\/p\//, () => new Response(productHtml)]]);
    const items = await collect(crawler(fetchFn).search('camisa preta', { limit: 2 }));
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.ok)).toBe(true);
  });

  it('registra falha por produto sem interromper o crawl', async () => {
    const fetchFn = fakeFetch([[/\/p\//, () => new Response('<html>mudou</html>')]]);
    const items = await collect(crawler(fetchFn).search('camisa', { limit: 2 }));
    expect(items).toHaveLength(2);
    expect(items.every((item) => !item.ok)).toBe(true);
  });

  it('interrompe o crawl quando a loja nega acesso (sem tentar contornar)', async () => {
    const fetchFn = fakeFetch([[/\/p\//, () => new Response('forbidden', { status: 403 })]]);
    await expect(collect(crawler(fetchFn).search('camisa', { limit: 2 }))).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    expect(fetchFn.calls.filter((url) => url.includes('/p/'))).toHaveLength(1);
  });

  it('search() lê as peças direto dos cartões da busca, com gênero pelo filtro (sem abrir produtos)', async () => {
    const fetchFn = fakeFetch([]);
    const renner = crawler(fetchFn, (url) =>
      url.includes('Masculino') ? onlyCards([1]) : onlyCards([0, 1, 2]),
    );
    const items = await collect(renner.search('camiseta', { limit: 10 }));

    expect(fetchFn.calls).toHaveLength(0);
    const products = items.flatMap((item) => (item.ok ? [item.product] : []));
    expect(products).toHaveLength(3);
    const byName = Object.fromEntries(products.map((p) => [p.name, p.gender]));
    // Aparece nas duas buscas (masculino e feminino) -> unissex.
    expect(byName['Camiseta Regular em Algodão com Manga Dobrada']).toBe('unissex');
    expect(byName['Camiseta Básica em Algodão com Manga Curta']).toBe('feminino');
  });

  it('search() respeita o limite dividindo entre os gêneros', async () => {
    const renner = crawler(fakeFetch([]), (url) =>
      url.includes('Masculino') ? onlyCards([0]) : onlyCards([1, 2]),
    );
    const items = await collect(renner.search('camiseta', { limit: 2 }));
    expect(items).toHaveLength(2);
  });
});

describe('Renner cartões da busca', () => {
  it('extrai nome, preço com e sem desconto, foto, link e disponibilidade do HTML real', () => {
    const cards = parseSearchCards(cardsHtml, BASE);
    expect(cards).toHaveLength(3);
    expect(cards[0]).toEqual({
      externalId: '548143390',
      productUrl: `${BASE}/p/camiseta-basica-em-algodao-com-manga-curta/-/A-548143390-br.lr`,
      name: 'Camiseta Básica em Algodão com Manga Curta',
      price: 49.9,
      listPrice: 59.9,
      imageUrl: expect.stringMatching(/^https:\/\/img\.lojasrenner\.com\.br\//),
      available: true,
    });
    expect(cards[1]?.listPrice).toBeUndefined();
    expect(cards[1]?.price).toBe(39.9);
  });

  it('cartão vira produto válido no normalizador', () => {
    const [card] = parseSearchCards(cardsHtml, BASE);
    const normalized = normalizeProduct(mapRennerSearchCard(card!, 'feminino'));
    expect(normalized).toMatchObject({
      externalId: '548143390',
      gender: 'feminino',
      price: 49.9,
      originalPrice: 59.9,
      categorySlug: expect.any(String),
    });
  });
});
