import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';
import {
  GoogleShoppingBlockedError,
  GoogleShoppingParseError,
  GoogleShoppingUnavailableError,
} from '../../src/modules/crawlers/google-shopping/google-shopping.errors.js';
import {
  extractExternalId,
  extractImage,
  extractProductUrl,
  extractRating,
  extractReviewCount,
  extractSeller,
  extractTitle,
  parseGoogleShoppingHtml,
} from '../../src/modules/crawlers/google-shopping/google-shopping.html-parser.js';
import { parseSerpApiResponse } from '../../src/modules/crawlers/google-shopping/google-shopping.serpapi-parser.js';
import { readFixture, readJsonFixture } from '../helpers/fixtures.js';

const BASE_URL = 'https://www.google.com.br';
const parseFixture = (name: string) =>
  parseGoogleShoppingHtml({ html: readFixture(`google-shopping/${name}`), baseUrl: BASE_URL });

describe('parseGoogleShoppingHtml — regressão (search-success.html)', () => {
  const products = parseFixture('search-success.html');

  it('extrai um produto por cartão, na ordem da página', () => {
    expect(products.map((p) => p.position)).toEqual([1, 2, 3]);
  });

  it('extrai todos os campos do primeiro cartão', () => {
    expect(products[0]).toEqual({
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
    });
  });

  it('lê "(1,2 mil)" como 1200 avaliações', () => {
    expect(products[1]?.reviewCount).toBe(1200);
    expect(products[1]?.rating).toBe(4.2);
  });

  it('não confunde números do título com o preço e lê milhar brasileiro', () => {
    expect(products[2]?.title).toBe('Kit 3 Camisetas Pretas Dry Fit');
    expect(products[2]?.price).toBe(1299);
  });

  it('ignora miniatura inline (data:) e usa data-src', () => {
    expect(products[2]?.imageUrl).toBe('https://encrypted-tbn0.gstatic.com/shopping?q=tbn:1003');
  });

  it('cartão sem avaliação fica sem rating/reviewCount', () => {
    expect(products[2]?.rating).toBeUndefined();
    expect(products[2]?.reviewCount).toBeUndefined();
  });

  it('decodifica entidades no vendedor', () => {
    expect(products[2]?.seller).toBe('Esporte & Cia');
  });
});

describe('parseGoogleShoppingHtml — campos ausentes viram undefined', () => {
  it.each([
    ['missing-price.html', 'price'],
    ['missing-image.html', 'imageUrl'],
    ['missing-seller.html', 'seller'],
    ['missing-rating.html', 'rating'],
  ] as const)('%s -> %s undefined, resto preenchido', (fixture, field) => {
    const [product] = parseFixture(fixture);
    expect(product?.[field]).toBeUndefined();
    expect(product?.title).toBeTruthy();
    expect(product?.productUrl).toMatch(/^https:\/\//);
  });

  it('sem preço também fica sem moeda (nada é inventado)', () => {
    expect(parseFixture('missing-price.html')[0]?.currency).toBeUndefined();
  });
});

describe('parseGoogleShoppingHtml — páginas inesperadas', () => {
  it('HTML parcialmente quebrado: extrai o que dá, cartão a cartão', () => {
    const products = parseFixture('partially-broken.html');
    expect(products[0]).toMatchObject({ title: 'Camiseta Preta Inteira', price: 45 });
    // Link javascript: é descartado.
    expect(products.find((p) => p.title === 'Camiseta Link Inválido')?.productUrl).toBeUndefined();
  });

  it('layout antigo (.sh-dgr__grid-result) continua funcionando', () => {
    expect(parseFixture('search-legacy-layout.html')[0]).toEqual({
      position: 1,
      externalId: '123456789',
      title: 'Camiseta Preta Estampada',
      price: 79.9,
      currency: 'BRL',
      imageUrl: 'https://encrypted-tbn1.gstatic.com/shopping?q=tbn:legacy',
      productUrl: 'https://www.google.com.br/shopping/product/123456789?hl=pt-BR',
      seller: 'Loja Legada',
      rating: 4.5,
      reviewCount: 1234,
    });
  });

  it('página de resultados vazia -> []', () => {
    expect(parseFixture('empty-results.html')).toEqual([]);
  });

  it('página de bloqueio real (CAPTCHA) -> GoogleShoppingBlockedError', () => {
    expect(() => parseFixture('blocked.html')).toThrow(GoogleShoppingBlockedError);
  });

  it('página que não é do Google Shopping -> GoogleShoppingParseError', () => {
    expect(() => parseFixture('unexpected.html')).toThrow(GoogleShoppingParseError);
  });

  it('HTML vazio -> GoogleShoppingParseError', () => {
    expect(() => parseGoogleShoppingHtml({ html: '  ', baseUrl: BASE_URL })).toThrow(
      GoogleShoppingParseError,
    );
  });

  it('página de resultados sem cartões (layout mudou) -> GoogleShoppingParseError', () => {
    const html =
      '<html><body><div id="search"><div id="rso"><p>algo novo</p></div></div></body></html>';
    expect(() => parseGoogleShoppingHtml({ html, baseUrl: BASE_URL })).toThrow(
      expect.objectContaining({
        code: 'GOOGLE_SHOPPING_PARSE_ERROR',
        reason: expect.stringMatching(/layout/),
      }),
    );
  });
});

describe('extratores de campo (um por responsabilidade)', () => {
  const card = (html: string) => cheerio.load(`<div id="c">${html}</div>`)('#c');

  it('extractTitle cai para aria-label e alt da imagem', () => {
    expect(extractTitle(card('<a aria-label="Título do link"></a>'))).toBe('Título do link');
    expect(extractTitle(card('<img alt="Título da imagem">'))).toBe('Título da imagem');
    expect(extractTitle(card('<p>nada</p>'))).toBeUndefined();
  });

  it('extractProductUrl desembrulha /url?q= e ignora esquemas não-http', () => {
    expect(extractProductUrl(card('<a href="/url?q=https://loja.com/x">x</a>'), BASE_URL)).toBe(
      'https://loja.com/x',
    );
    expect(extractProductUrl(card('<a href="javascript:void(0)">x</a>'), BASE_URL)).toBeUndefined();
    expect(
      extractProductUrl(card('<a href="/url?q=javascript:alert(1)">x</a>'), BASE_URL),
    ).toBeUndefined();
  });

  it('extractImage ignora imagens sem URL http(s)', () => {
    expect(extractImage(card('<img src="data:image/png;base64,AAA">'))).toBeUndefined();
  });

  it('extractSeller, extractRating, extractReviewCount e extractExternalId', () => {
    const c = card(
      '<a href="/shopping/product/987"></a><div class="aULzUe">Loja</div>' +
        '<span aria-label="Rated 3.5 out of 5"></span><span aria-label="12 reviews"></span>',
    );
    expect(extractSeller(c)).toBe('Loja');
    expect(extractRating(c)).toBe(3.5);
    expect(extractReviewCount(c)).toBe(12);
    expect(extractExternalId(c)).toBe('987');
  });

  it('nota fora de 0–5 é descartada', () => {
    expect(extractRating(card('<span class="Rsc7Yb">47</span>'))).toBeUndefined();
  });
});

describe('parseSerpApiResponse', () => {
  const products = parseSerpApiResponse(readJsonFixture('google-shopping/serpapi-success.json'));

  it('extrai todos os campos do resultado completo', () => {
    expect(products[0]).toEqual({
      position: 1,
      externalId: '111',
      title: 'Camiseta Preta Básica Masculina',
      price: 49.9,
      currency: 'BRL',
      imageUrl: 'https://encrypted-tbn0.gstatic.com/shopping?q=tbn:111',
      productUrl: 'https://www.google.com.br/shopping/product/111?gl=br',
      seller: 'Loja Exemplo',
      rating: 4.7,
      reviewCount: 352,
    });
  });

  it('usa `link` sem product_link, preço em texto sem extracted_price e descarta thumbnail inválida', () => {
    expect(products[1]).toMatchObject({
      externalId: '222',
      productUrl: 'https://www.modacenter.com.br/p/222',
      price: 1299,
      imageUrl: undefined,
    });
  });

  it('campo com tipo inesperado vira undefined; item que não é objeto vira item vazio', () => {
    expect(products[2]?.rating).toBeUndefined();
    expect(products[2]?.price).toBeUndefined();
    expect(products[3]).toEqual({ position: 4 });
  });

  it('layout categorizado é achatado', () => {
    const categorized = parseSerpApiResponse(
      readJsonFixture('google-shopping/serpapi-categorized.json'),
    );
    expect(categorized.map((p) => p.title)).toEqual(['Camiseta A', 'Camiseta B']);
  });

  it('"sem resultados" -> []', () => {
    expect(
      parseSerpApiResponse(readJsonFixture('google-shopping/serpapi-no-results.json')),
    ).toEqual([]);
  });

  it('erro reportado pela SerpApi -> indisponível', () => {
    expect(() => parseSerpApiResponse({ error: 'Your account has run out of searches.' })).toThrow(
      GoogleShoppingUnavailableError,
    );
  });

  it('JSON que não é da SerpApi -> GoogleShoppingParseError', () => {
    expect(() => parseSerpApiResponse('texto')).toThrow(GoogleShoppingParseError);
    expect(() => parseSerpApiResponse({ qualquer: 1 })).toThrow(GoogleShoppingParseError);
  });
});
