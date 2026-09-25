import { describe, expect, it } from 'vitest';
import { CACrawler } from '../../src/modules/crawlers/ca/ca.crawler.js';
import { mapVtexProduct } from '../../src/modules/crawlers/ca/ca.mapper.js';
import {
  parseResourcesTotal,
  parseVtexSearchResponse,
} from '../../src/modules/crawlers/ca/ca.parser.js';
import type { CrawlItem } from '../../src/modules/crawlers/crawler.types.js';
import { normalizeProduct } from '../../src/modules/crawlers/normalizer/product.normalizer.js';
import { HttpClient } from '../../src/modules/crawlers/shared/http-client.js';
import { fakeFetch, readJsonFixture } from '../helpers/fixtures.js';

const fixture = readJsonFixture<unknown[]>('ca-search.json');

async function collect(items: AsyncIterable<CrawlItem>) {
  const result: CrawlItem[] = [];
  for await (const item of items) result.push(item);
  return result;
}

function client(fetchFn: typeof fetch) {
  return new HttpClient({
    userAgent: 'test',
    timeoutMs: 1_000,
    maxRetries: 1,
    minDelayMs: 0,
    fetchFn,
  });
}

describe('C&A parser', () => {
  it('interpreta a resposta real da API VTEX', () => {
    const entries = parseVtexSearchResponse(fixture);
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.ok)).toBe(true);
  });

  it('isola produtos malformados sem invalidar a página', () => {
    const entries = parseVtexSearchResponse([fixture[0], { productId: '999' }]);
    expect(entries[0]?.ok).toBe(true);
    expect(entries[1]).toMatchObject({ ok: false, reference: '999' });
  });

  it('rejeita payload que não é lista', () => {
    expect(() => parseVtexSearchResponse({ error: 'x' })).toThrow(/expected an array/);
  });

  it('lê o total do header resources', () => {
    expect(parseResourcesTotal('0-49/37175')).toBe(37175);
    expect(parseResourcesTotal(null)).toBeNull();
  });
});

describe('C&A mapper + normalizer', () => {
  it('mapeia o produto real para ScrapedProduct e normaliza', () => {
    const [entry] = parseVtexSearchResponse(fixture);
    if (!entry?.ok) throw new Error('fixture inválido');

    const scraped = mapVtexProduct(entry.product);
    expect(scraped).toMatchObject({
      externalId: '4558067',
      name: 'camisa feminina de algodão manga curta com pregas preta',
      gender: 'Feminino',
      color: 'Preto',
      price: 139.99,
      currency: 'BRL',
      available: true,
      productUrl: expect.stringMatching(/^https:\/\/www\.cea\.com\.br\/.+\/p$/),
    });
    expect(scraped.imageUrl).toMatch(/^https:\/\/cea\.vteximg\.com\.br\//);
    expect(scraped.size?.split(', ')[0]).toBe('PP');

    const normalized = normalizeProduct(scraped);
    expect(normalized).toMatchObject({
      name: 'Camisa Feminina de Algodão Manga Curta com Pregas Preta',
      gender: 'feminino',
      color: 'preto',
      categorySlug: 'camisas',
      originalPrice: null,
    });
  });
});

describe('CACrawler', () => {
  it('busca pelo termo no caminho da URL (sem ft=, bloqueado no robots.txt)', async () => {
    const fetchFn = fakeFetch([
      [
        /\/search\/camisa%20preta\?_from=0&_to=1$/,
        () => Response.json(fixture, { headers: { resources: '0-1/2' } }),
      ],
    ]);
    const items = await collect(
      new CACrawler(client(fetchFn)).search('camisa preta', { limit: 2 }),
    );

    expect(items).toHaveLength(2);
    expect(fetchFn.calls).toHaveLength(1);
    expect(fetchFn.calls[0]).not.toMatch(/[?&](ft|fq|O|map)=/);
  });

  it('pagina até atingir o limite e divide o limite entre categorias', async () => {
    const fetchFn = fakeFetch([
      [/\/search\/moda-feminina\/roupas\?/, () => Response.json(fixture)],
      [/\/search\/moda-masculina\/roupas\?/, () => Response.json(fixture)],
    ]);
    const crawler = new CACrawler(client(fetchFn));
    const items = await collect(crawler.crawl({ limit: 4 }));

    expect(items).toHaveLength(4);
    expect(fetchFn.calls.some((url) => url.includes('moda-feminina'))).toBe(true);
    expect(fetchFn.calls.some((url) => url.includes('moda-masculina'))).toBe(true);
  });

  it('falha numa categoria não derruba a sincronização: segue pras próximas', async () => {
    const fetchFn = fakeFetch([
      [/\/search\/moda-feminina\/roupas\?/, () => new Response('erro', { status: 500 })],
      [/\/search\/moda-masculina\/roupas\?/, () => Response.json(fixture)],
    ]);
    const items = await collect(new CACrawler(client(fetchFn)).crawl({ limit: 4 }));

    expect(items.filter((item) => !item.ok)).toHaveLength(1);
    expect(items.filter((item) => item.ok).length).toBeGreaterThan(0);
  });

  it('todas as categorias falhando -> o crawl falha (pode ser repetido)', async () => {
    const fetchFn = fakeFetch([[/\/search\//, () => new Response('erro', { status: 500 })]]);
    await expect(collect(new CACrawler(client(fetchFn)).crawl({ limit: 4 }))).rejects.toThrow();
  });

  it('usa as categorias configuradas na Source', async () => {
    const fetchFn = fakeFetch([[/\/search\/moda-infantil\?/, () => Response.json([])]]);
    await collect(
      new CACrawler(client(fetchFn)).crawl({ config: { categories: ['moda-infantil'] } }),
    );
    expect(fetchFn.calls).toEqual([
      'https://www.cea.com.br/api/catalog_system/pub/products/search/moda-infantil?_from=0&_to=49',
    ]);
  });
});
