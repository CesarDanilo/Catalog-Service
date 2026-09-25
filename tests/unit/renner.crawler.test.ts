import { describe, expect, it } from 'vitest';
import type { CrawlItem } from '../../src/modules/crawlers/crawler.types.js';
import { normalizeProduct } from '../../src/modules/crawlers/normalizer/product.normalizer.js';
import { RennerCrawler } from '../../src/modules/crawlers/renner/renner.crawler.js';
import {
  mapRennerFindDoc,
  mapRennerProduct,
} from '../../src/modules/crawlers/renner/renner.mapper.js';
import {
  extractProductIdFromUrl,
  parseFindResponse,
  parseProductLinks,
  parseRennerProductPage,
} from '../../src/modules/crawlers/renner/renner.parser.js';
import type { BrowserPool } from '../../src/modules/crawlers/shared/browser.js';
import { AccessDeniedError, HttpClient } from '../../src/modules/crawlers/shared/http-client.js';
import { parseSitemap } from '../../src/modules/crawlers/shared/sitemap.js';
import { fakeFetch, readFixture, readJsonFixture } from '../helpers/fixtures.js';

const BASE = 'https://www.lojasrenner.com.br';
const PRODUCT_URL = `${BASE}/p/saida-de-praia-blusa-em-trico-com-manga-ampla-branco/-/A-931612620-br.lr`;
const productHtml = readFixture('renner-product.html');
const searchHtml = readFixture('renner-search-rendered.html');
const findJson = readJsonFixture<unknown>('renner-find.json');

async function collect(items: AsyncIterable<CrawlItem>) {
  const result: CrawlItem[] = [];
  for await (const item of items) result.push(item);
  return result;
}

function crawler(fetchFn: typeof fetch, renderedHtml = searchHtml, captured: unknown = null) {
  const browser = {
    renderHtml: async () => renderedHtml,
    captureJson: async (url: string) =>
      typeof captured === 'function' ? (captured as (url: string) => unknown)(url) : captured,
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
    pageDelayMs: 0,
  });
}

/** Resposta de busca fake com `count` produtos de ids `${prefix}-1..count`. */
function findResponse(prefix: string, count: number) {
  return {
    placements: [
      {
        docs: Array.from({ length: count }, (_, i) => ({
          id: `${prefix}${i}-COR`,
          parent_product_id: `${prefix}${i}`,
          name: `Peça ${prefix} ${i}`,
          linkId: `/p/peca-${prefix}-${i}/-/A-${prefix}${i}-br.lr`,
          priceCents: 9990,
          gender: ['Feminino'],
        })),
      },
    ],
  };
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

  it('search() lê as peças da resposta de busca que a página recebe (sem abrir produtos)', async () => {
    const fetchFn = fakeFetch([]);
    const items = await collect(crawler(fetchFn, searchHtml, findJson).search('blazer'));

    expect(fetchFn.calls).toHaveLength(0);
    // 3 documentos, 2 são cores do mesmo produto -> 2 peças.
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.ok)).toBe(true);
  });

  it('search() respeita o limite', async () => {
    const items = await collect(
      crawler(fakeFetch([]), searchHtml, findJson).search('blazer', { limit: 1 }),
    );
    expect(items).toHaveLength(1);
  });
});

describe('Renner resposta de busca', () => {
  it('mapeia gênero, cor, categoria, marca, preço com desconto, fotos e link', () => {
    const [doc] = parseFindResponse(findJson);
    const product = mapRennerFindDoc(doc!, BASE);
    expect(product).toMatchObject({
      externalId: '929412400',
      name: 'Blazer Alongado em Alfaiataria com Prega nas Mangas',
      brand: 'Blue Steel',
      gender: 'Feminino',
      color: 'Preto',
      category: 'Casacos e Jaquetas/Blazers',
      price: 159.9,
      originalPrice: 199.9,
      currency: 'BRL',
      productUrl: `${BASE}/p/blazer-alongado-em-alfaiataria-com-prega-nas-mangas/-/A-929412400-br.lr`,
      available: true,
    });
    expect(product.imageUrl).toMatch(/^https:\/\/img\.lojasrenner\.com\.br\//);

    const normalized = normalizeProduct(product);
    expect(normalized).toMatchObject({ gender: 'feminino', color: 'preto', originalPrice: 199.9 });
  });

  it('sem desconto não inventa preço "de"; documento inválido é ignorado', () => {
    const docs = parseFindResponse({
      placements: [
        {
          docs: [
            { lixo: true },
            ...(findJson as { placements: [{ docs: unknown[] }] }).placements[0].docs,
          ],
        },
      ],
    });
    expect(docs).toHaveLength(2);
    expect(mapRennerFindDoc(docs[1]!, BASE).originalPrice).toBeUndefined();
    expect(parseFindResponse(null)).toEqual([]);
  });
});

describe('Renner sincronização por termos de busca', () => {
  it('divide o limite entre os termos, pagina com &pagina=N e não repete peça', async () => {
    const urls: string[] = [];
    const renner = crawler(fakeFetch([]), searchHtml, (url: string) => {
      urls.push(url);
      if (url.includes('Ntt=vestido'))
        return url.includes('pagina=2') ? findResponse('2', 40) : findResponse('1', 40);
      // "saia": uma página só, com uma peça que já veio do "vestido".
      if (url.includes('pagina=')) return findResponse('9', 0);
      return {
        placements: [
          {
            docs: [
              ...findResponse('3', 5).placements[0]!.docs,
              findResponse('1', 1).placements[0]!.docs[0],
            ],
          },
        ],
      };
    });
    const items = await collect(
      renner.crawl({ limit: 120, config: { searchTerms: ['vestido', 'saia'] } }),
    );

    const ids = items.flatMap((item) => (item.ok ? [item.product.externalId] : []));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id.startsWith('1') || id.startsWith('2'))).toHaveLength(60);
    expect(ids.filter((id) => id.startsWith('3'))).toHaveLength(5);
    expect(urls.some((url) => url.includes('Ntt=vestido&pagina=2'))).toBe(true);
  });

  it('termo que falha vira falha registrada e os outros seguem', async () => {
    const renner = crawler(fakeFetch([]), searchHtml, (url: string) => {
      if (url.includes('Ntt=saia')) throw new Error('timeout');
      return url.includes('pagina=') ? findResponse('9', 0) : findResponse('1', 3);
    });
    const items = await collect(
      renner.crawl({ limit: 10, config: { searchTerms: ['saia', 'vestido'] } }),
    );
    expect(items.filter((item) => !item.ok)).toHaveLength(1);
    expect(items.filter((item) => item.ok)).toHaveLength(3);
  });

  it('todos os termos falhando -> o crawl falha (pode ser repetido)', async () => {
    const renner = crawler(fakeFetch([]), searchHtml, () => {
      throw new Error('fora do ar');
    });
    await expect(
      collect(renner.crawl({ limit: 10, config: { searchTerms: ['saia', 'vestido'] } })),
    ).rejects.toThrow('fora do ar');
  });
});
