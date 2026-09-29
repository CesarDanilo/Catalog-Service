import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GoogleShoppingBlockedError } from '../../src/modules/crawlers/google-shopping/google-shopping.errors.js';
import { buildGoogleShoppingTestApp } from '../helpers/google-shopping.js';

/**
 * HTTP -> LiveSearchService -> GoogleShoppingProvider -> "scraper" -> parser -> mapper,
 * com o scraper servindo fixtures (sem internet) e cache em memória (sem Redis/Postgres).
 */

const URL = '/api/v1/providers/google-shopping/search';

describe('GET /api/v1/providers/:source/search (google-shopping)', () => {
  let ctx: Awaited<ReturnType<typeof buildGoogleShoppingTestApp>>;

  beforeAll(async () => {
    ctx = await buildGoogleShoppingTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('200 com produtos normalizados, paginação e meta', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: URL,
      query: { q: 'camiseta preta', pageSize: '2' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toEqual({
      position: 1,
      externalId: '1001',
      title: 'Camiseta Preta Básica Masculina',
      price: 49.9,
      currency: 'BRL',
      imageUrl: 'https://encrypted-tbn0.gstatic.com/shopping?q=tbn:1001',
      productUrl: 'https://www.lojaexemplo.com.br/p/1001',
      seller: 'Loja Exemplo',
      rating: 4.7,
      reviewCount: 352,
      source: 'google-shopping',
    });
    expect(body.pagination).toEqual({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
    expect(body.meta).toEqual({
      source: 'google-shopping',
      country: 'BR',
      language: 'pt-BR',
      cached: false,
    });
  });

  it('página 2 e variações de caixa/espaço saem do cache (sem nova ida à fonte)', async () => {
    const before = ctx.fetcher.calls;
    const page2 = await ctx.app.inject({
      method: 'GET',
      url: URL,
      query: { q: '  Camiseta   PRETA ', pageSize: '2', page: '2' },
    });
    expect(page2.statusCode).toBe(200);
    expect(page2.json().data.map((p: { position: number }) => p.position)).toEqual([3]);
    expect(page2.json().meta.cached).toBe(true);
    expect(ctx.fetcher.calls).toBe(before);
  });

  it('não expõe HTML, rawData nem campos internos', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: URL,
      query: { q: 'camiseta preta' },
    });
    expect(response.body).not.toContain('<div');
    expect(response.body).not.toContain('rawData');
    expect(response.body).not.toContain('data-docid');
  });

  it.each([
    [{}, 'q ausente'],
    [{ q: '' }, 'q vazia'],
    [{ q: 'x'.repeat(121) }, 'q longa'],
    [{ q: 'x', page: '0' }, 'page 0'],
    [{ q: 'x', pageSize: '1000' }, 'pageSize grande'],
    [{ q: 'x', country: 'Brasil' }, 'country inválido'],
  ])('400 para %o (%s)', async (query: Record<string, string>, _reason: string) => {
    const response = await ctx.app.inject({ method: 'GET', url: URL, query });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('não aceita URL arbitrária: parâmetro "url" é ignorado e a fonte só recebe o termo', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: URL,
      query: { q: 'vestido', url: 'https://qualquer-site.com' },
    });
    expect(response.statusCode).toBe(200);
    expect(ctx.fetcher.queries.at(-1)).toBe('vestido');
  });

  it('404 PROVIDER_NOT_FOUND para provider inexistente', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/providers/mercado-livre/search',
      query: { q: 'x' },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('PROVIDER_NOT_FOUND');
  });

  it('CAPTCHA -> 503 GOOGLE_SHOPPING_BLOCKED, sem retry e sem detalhes internos', async () => {
    ctx.fetcher.next = 'blocked.html';
    const before = ctx.fetcher.calls;
    const response = await ctx.app.inject({ method: 'GET', url: URL, query: { q: 'bloqueio' } });
    ctx.fetcher.next = 'search-success.html';

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: {
        code: 'GOOGLE_SHOPPING_BLOCKED',
        message: new GoogleShoppingBlockedError('x').message,
      },
    });
    expect(ctx.fetcher.calls - before).toBe(1);
  });

  it('página inesperada -> 502 GOOGLE_SHOPPING_PARSE_ERROR (erro não fica no cache)', async () => {
    ctx.fetcher.next = 'unexpected.html';
    const first = await ctx.app.inject({ method: 'GET', url: URL, query: { q: 'estranho' } });
    ctx.fetcher.next = 'search-success.html';
    const second = await ctx.app.inject({ method: 'GET', url: URL, query: { q: 'estranho' } });

    expect(first.statusCode).toBe(502);
    expect(first.json().error.code).toBe('GOOGLE_SHOPPING_PARSE_ERROR');
    expect(second.statusCode).toBe(200);
  });
});
