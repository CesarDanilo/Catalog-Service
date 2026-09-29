import { describe, expect, it } from 'vitest';
import type { CrawlItem } from '../../src/modules/crawlers/crawler.types.js';
import { normalizeProduct } from '../../src/modules/crawlers/normalizer/product.normalizer.js';
import { HttpClient } from '../../src/modules/crawlers/shared/http-client.js';
import {
  DEFAULT_VTEX_SEARCH_TERMS,
  VtexCrawler,
} from '../../src/modules/crawlers/vtex/vtex.crawler.js';
import { mapVtexProduct } from '../../src/modules/crawlers/vtex/vtex.mapper.js';
import {
  parseVtexSearchResponse,
  readAttribute,
  type VtexProduct,
} from '../../src/modules/crawlers/vtex/vtex.parser.js';
import { VTEX_STORES, type VtexStore } from '../../src/modules/crawlers/vtex/vtex.stores.js';
import { fakeFetch, readJsonFixture } from '../helpers/fixtures.js';

async function collect(items: AsyncIterable<CrawlItem>) {
  const result: CrawlItem[] = [];
  for await (const item of items) result.push(item);
  return result;
}

const client = (fetchFn: typeof fetch) =>
  new HttpClient({ userAgent: 'test', timeoutMs: 1_000, maxRetries: 1, minDelayMs: 0, fetchFn });

const store = (source: string): VtexStore => {
  const found = VTEX_STORES.find((s) => s.source === source);
  if (!found) throw new Error(`store ${source} not found`);
  return found;
};

function firstProduct(source: string): VtexProduct {
  const [entry] = parseVtexSearchResponse(readJsonFixture(`vtex/${source}-search.json`));
  if (!entry?.ok) throw new Error(`fixture ${source} did not parse`);
  return entry.product;
}

describe('lojas VTEX — fixtures reais (2026-09-29)', () => {
  // Especificações com nomes diferentes em cada loja viram o mesmo gênero/cor normalizados.
  it.each([
    ['hering', 'Camiseta Feminina Slim Em Algodão - Rosa', 99.99, 'feminino', 'rosa'],
    ['reserva', 'Camiseta Slim Modal Color', 269.9, 'masculino', 'preto'],
    ['malwee', 'Camiseta Pima Feminina', 199, 'feminino', 'bege'],
    ['aramis', 'Camiseta Bordado Caveira Branco', 169.9, 'masculino', 'branco'],
    ['mash', 'Camiseta Básica de Microfibra Preto', 125.9, null, 'preto'],
    ['lupo', 'Camiseta Algodão Feminina Lupo', 61.9, 'feminino', 'rosa'],
  ] as const)('%s: %s', (source, name, price, gender, color) => {
    const vtexStore = store(source);
    const scraped = mapVtexProduct(firstProduct(source), vtexStore);
    const normalized = normalizeProduct(scraped);

    expect(scraped.name).toBe(name);
    expect(scraped.price).toBe(price);
    expect(scraped.currency).toBe('BRL');
    expect(scraped.productUrl.startsWith(vtexStore.baseUrl)).toBe(true);
    expect(scraped.imageUrl).toMatch(/^https:\/\/.+vteximg\.com\.br\//);
    expect(scraped.size).toBeTruthy();
    expect(scraped.available).toBe(true);
    expect(normalized.gender).toBe(gender);
    expect(normalized.color).toBe(color);
    expect(normalized.categorySlug).toBe('camisetas');
  });

  it('todas as fixtures são válidas item a item', () => {
    for (const { source } of VTEX_STORES.filter((s) => s.source !== 'ca')) {
      const entries = parseVtexSearchResponse(readJsonFixture(`vtex/${source}-search.json`));
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.every((entry) => entry.ok)).toBe(true);
    }
  });

  it('gênero "Male" + faixa etária (Reserva) e cor só no SKU (Malwee)', () => {
    expect(mapVtexProduct(firstProduct('reserva')).gender).toBe('Male adult');
    expect(mapVtexProduct(firstProduct('malwee')).color).toBe('Bege');
  });

  it('faixa etária infantil vira infantil mesmo com gênero informado', () => {
    const product = { ...firstProduct('malwee'), 'Faixa Etária': ['Infantil'] };
    expect(normalizeProduct(mapVtexProduct(product)).gender).toBe('infantil');
  });

  it('defaultGender da loja só entra quando o produto não informa gênero', () => {
    expect(mapVtexProduct(firstProduct('aramis'), { defaultGender: 'masculino' }).gender).toBe(
      'masculino',
    );
    expect(mapVtexProduct(firstProduct('hering'), { defaultGender: 'masculino' }).gender).toBe(
      'Feminino',
    );
  });
});

describe('readAttribute', () => {
  it('ignora caixa e acento, respeita a ordem dos nomes e pula valores vazios', () => {
    const record = { GÊNERO: ['Feminino'], cores: [' ', 'Azul'], Cor: [] };
    expect(readAttribute(record, ['genero'])).toBe('Feminino');
    expect(readAttribute(record, ['Cor', 'Cores'])).toBe('Azul');
    expect(readAttribute(record, ['Tamanho'])).toBeUndefined();
    expect(readAttribute({ Tamanho: 'M' }, ['tamanho'])).toBe('M');
  });
});

describe('VtexCrawler', () => {
  const hering = store('hering');
  const page = () => Response.json(readJsonFixture('vtex/hering-search.json'));
  const searchUrl = (path: string) =>
    new RegExp(
      `^https://www\\.hering\\.com\\.br/api/catalog_system/pub/products/search/${path}\\?`,
    );

  it('busca usa o termo no caminho (sem ft=/fq=, bloqueados no robots de várias lojas)', async () => {
    const fetchFn = fakeFetch([[searchUrl('cal%C3%A7a%20jeans'), page]]);
    const items = await collect(
      new VtexCrawler(client(fetchFn), hering).search('calça jeans', { limit: 2 }),
    );
    expect(items.filter((item) => item.ok)).toHaveLength(2);
    expect(fetchFn.calls[0]).toBe(
      'https://www.hering.com.br/api/catalog_system/pub/products/search/cal%C3%A7a%20jeans?_from=0&_to=1',
    );
    expect(fetchFn.calls.join()).not.toMatch(/[?&](ft|fq|O|map)=/);
    expect(items[0]?.ok && items[0].product.productUrl).toContain('hering.com.br');
  });

  it('sincronização sem configuração percorre os termos padrão', async () => {
    const fetchFn = fakeFetch([[/products\/search\//, page]]);
    await collect(
      new VtexCrawler(client(fetchFn), hering).crawl({ limit: DEFAULT_VTEX_SEARCH_TERMS.length }),
    );
    const paths = fetchFn.calls.map((url) =>
      decodeURIComponent(new URL(url).pathname.split('/').pop() ?? ''),
    );
    expect(paths).toEqual(DEFAULT_VTEX_SEARCH_TERMS);
  });

  it('Source.config.searchTerms e categories têm precedência (categories primeiro)', async () => {
    const byTerms = fakeFetch([[/products\/search\//, page]]);
    await collect(
      new VtexCrawler(client(byTerms), hering).crawl({
        limit: 2,
        config: { searchTerms: ['polo', 'regata'] },
      }),
    );
    expect(byTerms.calls.map((url) => new URL(url).pathname.split('/').pop())).toEqual([
      'polo',
      'regata',
    ]);

    const byCategories = fakeFetch([[/products\/search\//, page]]);
    await collect(
      new VtexCrawler(client(byCategories), hering).crawl({
        limit: 1,
        config: { categories: ['feminino/camisetas'], searchTerms: ['polo'] },
      }),
    );
    expect(new URL(byCategories.calls[0]!).pathname).toBe(
      '/api/catalog_system/pub/products/search/feminino/camisetas',
    );
  });

  it('C&A continua sincronizando pelas categorias padrão', async () => {
    const fetchFn = fakeFetch([
      [/products\/search\//, () => Response.json(readJsonFixture('ca-search.json'))],
    ]);
    await collect(new VtexCrawler(client(fetchFn), store('ca')).crawl({ limit: 2 }));
    expect(
      fetchFn.calls.map((url) =>
        new URL(url).pathname.replace('/api/catalog_system/pub/products/search/', ''),
      ),
    ).toEqual(['moda-feminina/roupas', 'moda-masculina/roupas']);
  });

  it('loja que bloqueia (403) interrompe a sincronização sem tentar os outros termos', async () => {
    const fetchFn = fakeFetch([
      [/products\/search\//, () => new Response('denied', { status: 403 })],
    ]);
    await expect(
      collect(new VtexCrawler(client(fetchFn), hering).crawl({ limit: 10 })),
    ).rejects.toMatchObject({
      retryable: false,
    });
    expect(fetchFn.calls).toHaveLength(1);
  });

  it('cada loja tem slug único e base https própria', () => {
    const slugs = VTEX_STORES.map((s) => s.source);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const { baseUrl } of VTEX_STORES) expect(baseUrl).toMatch(/^https:\/\/www\.[a-z.]+$/);
  });
});
