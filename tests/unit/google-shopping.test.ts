import { describe, expect, it, vi } from 'vitest';
import { GoogleShoppingBrowserFetcher } from '../../src/modules/crawlers/google-shopping/google-shopping.browser-fetcher.js';
import {
  GoogleShoppingBlockedError,
  GoogleShoppingInvalidRequestError,
  GoogleShoppingParseError,
  GoogleShoppingScraperError,
  GoogleShoppingTimeoutError,
  GoogleShoppingUnavailableError,
  toGoogleShoppingError,
} from '../../src/modules/crawlers/google-shopping/google-shopping.errors.js';
import { mapGoogleShoppingProduct } from '../../src/modules/crawlers/google-shopping/google-shopping.mapper.js';
import {
  GoogleShoppingProvider,
  type GoogleShoppingProviderDeps,
} from '../../src/modules/crawlers/google-shopping/google-shopping.provider.js';
import { GoogleShoppingSerpApiFetcher } from '../../src/modules/crawlers/google-shopping/google-shopping.serpapi-fetcher.js';
import type {
  GoogleShoppingFetcher,
  GoogleShoppingMarket,
  RawGoogleShoppingProduct,
} from '../../src/modules/crawlers/google-shopping/google-shopping.types.js';
import {
  buildRequest,
  buildSearchUrl,
  buildSerpApiUrl,
} from '../../src/modules/crawlers/google-shopping/google-shopping.url.js';
import {
  detectCurrency,
  parseCount,
  parseRating,
} from '../../src/modules/crawlers/google-shopping/google-shopping.values.js';
import type { BrowserPool } from '../../src/modules/crawlers/shared/browser.js';
import { liveSearchQuerySchema } from '../../src/modules/live-search/live-search.schema.js';
import { CrawlerError } from '../../src/shared/errors/app-error.js';
import {
  ConcurrencyLimiter,
  LimiterQueueFullError,
} from '../../src/shared/utils/concurrency-limiter.js';
import { retryWithBackoff } from '../../src/shared/utils/retry.js';
import { normalizeSearchQuery } from '../../src/shared/utils/text.js';

const MARKET: GoogleShoppingMarket = { country: 'BR', language: 'pt-BR', domain: 'google.com.br' };

describe('buildRequest / buildSearchUrl / buildSerpApiUrl', () => {
  it('"camiseta preta" gera URL válida do Google Shopping', () => {
    const url = buildSearchUrl(buildRequest('camiseta preta', MARKET));
    expect(url.origin).toBe('https://www.google.com.br');
    expect(url.pathname).toBe('/search');
    expect(url.searchParams.get('q')).toBe('camiseta preta');
    expect(url.searchParams.get('udm')).toBe('28');
    expect(url.searchParams.get('hl')).toBe('pt-BR');
    expect(url.searchParams.get('gl')).toBe('br');
    expect(url.href).toContain('q=camiseta+preta');
  });

  it('codifica acentos e caracteres especiais sem injetar parâmetros', () => {
    const url = buildSearchUrl(buildRequest('calça & blusa #1 ?x=y/ção', MARKET));
    expect(url.searchParams.get('q')).toBe('calça & blusa #1 ?x=y/ção');
    expect([...url.searchParams.keys()]).toEqual(['q', 'udm', 'hl', 'gl']);
    expect(url.hash).toBe('');
  });

  it('colapsa espaços, mas mantém a grafia', () => {
    expect(buildRequest('  Camiseta   Preta ', MARKET).query).toBe('Camiseta Preta');
  });

  it('rejeita query vazia e longa demais', () => {
    expect(() => buildRequest('   ', MARKET)).toThrow(GoogleShoppingInvalidRequestError);
    expect(() => buildRequest('a'.repeat(121), MARKET)).toThrow(GoogleShoppingInvalidRequestError);
    expect(buildRequest('a'.repeat(120), MARKET).query).toHaveLength(120);
  });

  it('só aceita domínios do Google e mercado bem formado (sem SSRF)', () => {
    for (const domain of [
      'evil.com',
      'google.com.evil.com',
      'google.com/x',
      'google.com@evil.com',
    ]) {
      expect(() => buildRequest('x', { ...MARKET, domain })).toThrow(
        GoogleShoppingInvalidRequestError,
      );
    }
    expect(() => buildRequest('x', { ...MARKET, country: 'BRA' })).toThrow();
    expect(() => buildRequest('x', { ...MARKET, language: 'pt_BR&x=1' })).toThrow();
  });

  it('mercado vem da configuração/requisição (US, PT) sem mudar código', () => {
    const us = buildSearchUrl(
      buildRequest('black t-shirt', { country: 'US', language: 'en', domain: 'google.com' }),
    );
    expect(us.origin).toBe('https://www.google.com');
    expect(us.searchParams.get('gl')).toBe('us');
    const pt = buildSearchUrl(
      buildRequest('t-shirt', { ...MARKET, country: 'PT', domain: 'google.pt' }),
    );
    expect(pt.origin).toBe('https://www.google.pt');
  });

  it('URL da SerpApi usa engine google_shopping e o mercado', () => {
    const url = buildSerpApiUrl(buildRequest('camiseta preta', MARKET), 'KEY');
    expect(url.origin + url.pathname).toBe('https://serpapi.com/search.json');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      engine: 'google_shopping',
      q: 'camiseta preta',
      google_domain: 'google.com.br',
      hl: 'pt-br',
      gl: 'br',
      api_key: 'KEY',
    });
  });
});

describe('normalizeSearchQuery', () => {
  it('variações de caixa/espaço viram a mesma chave, sem tirar acentos', () => {
    const variants = ['Camiseta Preta', 'Camiseta   Preta', ' camiseta preta ', 'CAMISETA PRETA'];
    expect(new Set(variants.map(normalizeSearchQuery))).toEqual(new Set(['camiseta preta']));
    expect(normalizeSearchQuery('Calça')).toBe('calça');
    // NFD e NFC viram a mesma string.
    expect(normalizeSearchQuery('calça')).toBe(normalizeSearchQuery('calça'));
  });
});

describe('valores (moeda, nota, contagem)', () => {
  it('detecta moeda só por símbolo inequívoco', () => {
    expect(detectCurrency('R$ 10,00')).toBe('BRL');
    expect(detectCurrency('US$ 10.00')).toBe('USD');
    expect(detectCurrency('€ 5')).toBe('EUR');
    expect(detectCurrency('$ 10')).toBeUndefined();
    expect(detectCurrency(undefined)).toBeUndefined();
  });

  it('nota e contagem', () => {
    expect(parseRating('4,7')).toBe(4.7);
    expect(parseRating(6)).toBeUndefined();
    expect(parseCount('(352)')).toBe(352);
    expect(parseCount('1.234 avaliações')).toBe(1234);
    expect(parseCount('2.5K')).toBe(2500);
    expect(parseCount('sem número')).toBeUndefined();
    expect(parseCount(3.5)).toBeUndefined();
  });
});

describe('mapGoogleShoppingProduct (Raw -> ScrapedProduct)', () => {
  const raw: RawGoogleShoppingProduct = {
    position: 1,
    externalId: '1001',
    title: 'Camiseta',
    price: 49.9,
    currency: 'BRL',
    imageUrl: 'https://img/1.jpg',
    productUrl: 'https://loja/p/1',
    seller: 'Loja',
    rating: 4.7,
    reviewCount: 352,
  };

  it('produto completo', () => {
    expect(mapGoogleShoppingProduct(raw, 'BRL')).toEqual({
      ok: true,
      product: {
        externalId: '1001',
        name: 'Camiseta',
        price: 49.9,
        currency: 'BRL',
        productUrl: 'https://loja/p/1',
        imageUrl: 'https://img/1.jpg',
        images: ['https://img/1.jpg'],
        available: true,
        seller: 'Loja',
        rating: 4.7,
        reviewCount: 352,
        rawData: { position: 1 },
      },
    });
  });

  it('opcionais ausentes não aparecem; moeda cai no padrão; id derivado do link é estável', () => {
    const minimal = { position: 2, title: 'X', price: 10, productUrl: 'https://loja/p/2' };
    const first = mapGoogleShoppingProduct(minimal, 'USD');
    const second = mapGoogleShoppingProduct(minimal, 'USD');
    expect(first.ok && first.product).toMatchObject({ currency: 'USD', available: true });
    expect(first.ok && Object.keys(first.product)).not.toContain('seller');
    expect(first.ok && first.product.externalId).toMatch(/^url-[0-9a-f]{24}$/);
    expect(first.ok && second.ok && first.product.externalId).toBe(
      second.ok && second.product.externalId,
    );
  });

  it('sem título, link ou preço vira falha isolada (nada inventado)', () => {
    expect(mapGoogleShoppingProduct({ position: 3, title: 'X' }, 'BRL')).toEqual({
      ok: false,
      reference: 'position-3',
      error: 'missing productUrl, price',
    });
  });
});

describe('erros', () => {
  it('cada erro tem status, código e mensagem pública próprios', () => {
    const cases: Array<[GoogleShoppingScraperError, number, string, boolean]> = [
      [new GoogleShoppingBlockedError('internal-1'), 503, 'GOOGLE_SHOPPING_BLOCKED', false],
      [new GoogleShoppingTimeoutError('internal-2'), 504, 'GOOGLE_SHOPPING_TIMEOUT', true],
      [new GoogleShoppingParseError('internal-3'), 502, 'GOOGLE_SHOPPING_PARSE_ERROR', false],
      [new GoogleShoppingUnavailableError('internal-4'), 503, 'GOOGLE_SHOPPING_UNAVAILABLE', false],
      [new GoogleShoppingScraperError('internal-5'), 502, 'GOOGLE_SHOPPING_ERROR', false],
    ];
    for (const [error, status, code, retryable] of cases) {
      expect(error).toBeInstanceOf(CrawlerError);
      expect([error.statusCode, error.code, error.retryable]).toEqual([status, code, retryable]);
      // O motivo técnico nunca vai na mensagem pública.
      expect(error.message).not.toContain(error.reason);
    }
  });

  it('toGoogleShoppingError mapeia falhas desconhecidas', () => {
    const blocked = new GoogleShoppingBlockedError('x');
    expect(toGoogleShoppingError(blocked)).toBe(blocked);
    const timeout = Object.assign(new Error('Timeout 15000ms exceeded'), { name: 'TimeoutError' });
    expect(toGoogleShoppingError(timeout)).toBeInstanceOf(GoogleShoppingTimeoutError);
    const unavailable = toGoogleShoppingError(new CrawlerError('no chromium', false));
    expect([unavailable.code, unavailable.retryable]).toEqual([
      'GOOGLE_SHOPPING_UNAVAILABLE',
      false,
    ]);
    expect(toGoogleShoppingError(new TypeError('fetch failed')).retryable).toBe(true);
  });
});

describe('liveSearchQuerySchema', () => {
  it('payload válido com padrões', () => {
    expect(liveSearchQuerySchema.parse({ q: ' camiseta preta ' })).toEqual({
      q: 'camiseta preta',
      page: 1,
      pageSize: 20,
    });
    expect(
      liveSearchQuerySchema.parse({
        q: 'x',
        page: '2',
        pageSize: '40',
        country: 'us',
        language: 'en',
      }),
    ).toMatchObject({ page: 2, pageSize: 40, country: 'US', language: 'en' });
  });

  it.each([
    [{}, 'q ausente'],
    [{ q: '   ' }, 'q vazia'],
    [{ q: 'a'.repeat(121) }, 'q longa'],
    [{ q: 'x', page: '0' }, 'page 0'],
    [{ q: 'x', page: '6' }, 'page acima do máximo'],
    [{ q: 'x', page: '1.5' }, 'page fracionária'],
    [{ q: 'x', pageSize: '0' }, 'pageSize 0'],
    [{ q: 'x', pageSize: '41' }, 'pageSize acima do máximo'],
    [{ q: 'x', country: 'BRA' }, 'country inválido'],
    [{ q: 'x', language: 'pt_BR' }, 'language inválido'],
  ])('%o é inválido (%s)', (payload: Record<string, string>, _reason: string) => {
    expect(liveSearchQuerySchema.safeParse(payload).success).toBe(false);
  });
});

describe('ConcurrencyLimiter', () => {
  it('nunca passa de maxConcurrent e recusa quando a fila enche', async () => {
    const limiter = new ConcurrencyLimiter({ maxConcurrent: 2, maxQueue: 1, minIntervalMs: 0 });
    let running = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    const task = () =>
      new Promise<void>((resolve) => {
        running++;
        peak = Math.max(peak, running);
        releases.push(() => {
          running--;
          resolve();
        });
      });

    const runs = [limiter.run(task), limiter.run(task), limiter.run(task)];
    await expect(limiter.run(task)).rejects.toBeInstanceOf(LimiterQueueFullError);
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases.shift()?.();
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases.splice(0).forEach((release) => release());
    await Promise.all(runs);
    expect(peak).toBe(2);
    expect([limiter.active, limiter.queued]).toEqual([0, 0]);
  });

  it('espaça o início das tarefas e libera a vaga mesmo se a tarefa falhar', async () => {
    const limiter = new ConcurrencyLimiter({ maxConcurrent: 1, maxQueue: 5, minIntervalMs: 50 });
    const starts: number[] = [];
    await expect(
      limiter.run(async () => {
        starts.push(Date.now());
        throw new Error('falhou');
      }),
    ).rejects.toThrow('falhou');
    await limiter.run(async () => void starts.push(Date.now()));
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(45);
    expect(limiter.active).toBe(0);
  });

  it('abortar enquanto espera na fila tira a tarefa da fila', async () => {
    const limiter = new ConcurrencyLimiter({ maxConcurrent: 1, maxQueue: 5, minIntervalMs: 0 });
    let release!: () => void;
    const first = limiter.run(() => new Promise<void>((resolve) => (release = resolve)));
    const controller = new AbortController();
    const second = limiter.run(async () => 'nunca', controller.signal);
    controller.abort(new Error('cancelado'));
    await expect(second).rejects.toThrow('cancelado');
    expect(limiter.queued).toBe(0);
    release();
    await first;
    expect(limiter.active).toBe(0);
  });
});

describe('retryWithBackoff', () => {
  it('repete só o que shouldRetry permite, com backoff exponencial e limite', async () => {
    const delays: number[] = [];
    const task = vi.fn().mockRejectedValue(new Error('passageiro'));
    await expect(
      retryWithBackoff(task, {
        maxAttempts: 3,
        baseDelayMs: 1,
        shouldRetry: () => true,
        onRetry: (_e, _a, delay) => delays.push(delay),
      }),
    ).rejects.toThrow('passageiro');
    expect(task).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([1, 2]);
  });

  it('não repete erro não-retentável', async () => {
    const task = vi.fn().mockRejectedValue(new GoogleShoppingBlockedError('captcha'));
    await expect(
      retryWithBackoff(task, { maxAttempts: 3, baseDelayMs: 1, shouldRetry: () => false }),
    ).rejects.toBeInstanceOf(GoogleShoppingBlockedError);
    expect(task).toHaveBeenCalledTimes(1);
  });
});

// ---------- Provider (orquestração) ----------

const PROVIDER_CONFIG: GoogleShoppingProviderDeps<string>['config'] = {
  defaultMarket: MARKET,
  defaultCurrency: 'BRL',
  maxConcurrency: 1,
  maxQueue: 5,
  requestDelayMs: 0,
  timeoutMs: 2_000,
  maxAttempts: 2,
  maxProducts: 60,
};

function fakeFetcher(
  impl: (attempt: number, signal: AbortSignal) => Promise<string>,
): GoogleShoppingFetcher<string> & { calls: number } {
  const fetcher = {
    name: 'fake',
    calls: 0,
    async fetch(_request: unknown, signal: AbortSignal) {
      fetcher.calls++;
      return { payload: await impl(fetcher.calls, signal), timings: { fakeMs: 1 } };
    },
  };
  return fetcher;
}

const rawProducts = (count: number): RawGoogleShoppingProduct[] =>
  Array.from({ length: count }, (_, i) => ({
    position: i + 1,
    title: `Peça ${i + 1}`,
    price: 10 + i,
    productUrl: `https://loja/p/${i + 1}`,
  }));

function logger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('GoogleShoppingProvider', () => {
  it('fetcher -> parser -> mapper, com log de sucesso sem dados sensíveis', async () => {
    const log = logger();
    const provider = new GoogleShoppingProvider({
      fetcher: fakeFetcher(async () => 'payload'),
      parse: () => [...rawProducts(2), { position: 3, title: 'Sem preço' }],
      config: PROVIDER_CONFIG,
      logger: log,
    });

    const result = await provider.liveSearch({ query: '  Camiseta   Preta ' });

    expect(result.products.map((p) => p.name)).toEqual(['Peça 1', 'Peça 2']);
    expect([result.country, result.language]).toEqual(['BR', 'pt-BR']);
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'google-shopping',
        query: 'camiseta preta',
        status: 'success',
        resultCount: 2,
        skipped: 1,
        durationMs: expect.any(Number),
        timings: expect.objectContaining({ fakeMs: 1, parseMs: expect.any(Number) }),
      }),
      'google shopping search',
    );
  });

  it('usa country/language da requisição', async () => {
    const seen: string[] = [];
    const provider = new GoogleShoppingProvider<string>({
      fetcher: {
        name: 'fake',
        fetch: async (request) => {
          seen.push(`${request.market.country}/${request.market.language}`);
          return { payload: '', timings: {} };
        },
      },
      parse: () => [],
      config: PROVIDER_CONFIG,
    });
    const result = await provider.liveSearch({ query: 'shirt', country: 'US', language: 'en' });
    expect(seen).toEqual(['US/en']);
    expect(result.country).toBe('US');
  });

  it('limita a quantidade de produtos (maxProducts)', async () => {
    const provider = new GoogleShoppingProvider({
      fetcher: fakeFetcher(async () => ''),
      parse: () => rawProducts(10),
      config: { ...PROVIDER_CONFIG, maxProducts: 3 },
    });
    expect((await provider.liveSearch({ query: 'x' })).products).toHaveLength(3);
  });

  it('bloqueio: não repete, loga "blocked" e propaga GoogleShoppingBlockedError', async () => {
    const log = logger();
    const fetcher = fakeFetcher(async () => {
      throw new GoogleShoppingBlockedError('redirected to /sorry/');
    });
    const provider = new GoogleShoppingProvider({
      fetcher,
      parse: () => [],
      config: { ...PROVIDER_CONFIG, maxAttempts: 3 },
      logger: log,
    });
    await expect(provider.liveSearch({ query: 'x' })).rejects.toBeInstanceOf(
      GoogleShoppingBlockedError,
    );
    expect(fetcher.calls).toBe(1);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'blocked', errorCode: 'GOOGLE_SHOPPING_BLOCKED' }),
      'google shopping search failed',
    );
  });

  it('bloqueio detectado pelo parser também não é repetido', async () => {
    const fetcher = fakeFetcher(async () => '');
    const provider = new GoogleShoppingProvider({
      fetcher,
      parse: () => {
        throw new GoogleShoppingBlockedError('captcha page');
      },
      config: { ...PROVIDER_CONFIG, maxAttempts: 3 },
    });
    await expect(provider.liveSearch({ query: 'x' })).rejects.toBeInstanceOf(
      GoogleShoppingBlockedError,
    );
    expect(fetcher.calls).toBe(1);
  });

  it('falha passageira é repetida (dentro do limite) e depois dá certo', async () => {
    const fetcher = fakeFetcher(async (attempt) => {
      if (attempt === 1) throw new TypeError('fetch failed');
      return 'ok';
    });
    const provider = new GoogleShoppingProvider({
      fetcher,
      parse: () => rawProducts(1),
      config: PROVIDER_CONFIG,
    });
    expect((await provider.liveSearch({ query: 'x' })).products).toHaveLength(1);
    expect(fetcher.calls).toBe(2);
  });

  it('prazo total estourado -> GoogleShoppingTimeoutError, mesmo com fetcher travado', async () => {
    const provider = new GoogleShoppingProvider({
      fetcher: fakeFetcher(() => new Promise<string>(() => undefined)),
      parse: () => [],
      config: { ...PROVIDER_CONFIG, timeoutMs: 50 },
    });
    await expect(provider.liveSearch({ query: 'x' })).rejects.toBeInstanceOf(
      GoogleShoppingTimeoutError,
    );
  });

  it('fila cheia -> indisponível, sem abrir mais buscas', async () => {
    let release!: () => void;
    const fetcher = fakeFetcher(
      () => new Promise<string>((resolve) => (release = () => resolve(''))),
    );
    const provider = new GoogleShoppingProvider({
      fetcher,
      parse: () => [],
      config: { ...PROVIDER_CONFIG, maxQueue: 0 },
    });
    const first = provider.liveSearch({ query: 'x' });
    await vi.waitFor(() => expect(fetcher.calls).toBe(1));
    await expect(provider.liveSearch({ query: 'y' })).rejects.toMatchObject({
      code: 'GOOGLE_SHOPPING_UNAVAILABLE',
      reason: expect.stringMatching(/queue full/),
    });
    release();
    await first;
    expect(fetcher.calls).toBe(1);
  });

  it('query inválida é recusada antes de acessar a fonte', async () => {
    const fetcher = fakeFetcher(async () => '');
    const provider = new GoogleShoppingProvider({
      fetcher,
      parse: () => [],
      config: PROVIDER_CONFIG,
    });
    await expect(provider.liveSearch({ query: '  ' })).rejects.toBeInstanceOf(
      GoogleShoppingInvalidRequestError,
    );
    expect(fetcher.calls).toBe(0);
  });

  it('segue o contrato Crawler: search() itera produtos; crawl() não é suportado', async () => {
    const provider = new GoogleShoppingProvider({
      fetcher: fakeFetcher(async () => ''),
      parse: () => rawProducts(5),
      config: PROVIDER_CONFIG,
    });
    const items = [];
    for await (const item of provider.search('x', { limit: 2 })) items.push(item);
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.ok)).toBe(true);

    const crawl = provider.crawl()[Symbol.asyncIterator]().next();
    await expect(crawl).rejects.toMatchObject({ retryable: false });
  });
});

// ---------- Fetchers ----------

describe('GoogleShoppingSerpApiFetcher', () => {
  const request = buildRequest('camiseta preta', MARKET);
  const fetcherWith = (response: () => Response | Promise<Response>) =>
    new GoogleShoppingSerpApiFetcher({
      apiKey: 'SECRET-KEY',
      timeoutMs: 1_000,
      fetchFn: (async () => response()) as typeof fetch,
    });

  it('devolve o JSON bruto', async () => {
    const result = await fetcherWith(() => Response.json({ shopping_results: [] })).fetch(
      request,
      new AbortController().signal,
    );
    expect(result.payload).toEqual({ shopping_results: [] });
    expect(result.timings.requestMs).toEqual(expect.any(Number));
  });

  it.each([
    [401, false],
    [429, false],
    [500, true],
    [503, true],
  ])('HTTP %i -> indisponível (retryable=%s), sem vazar a API key', async (status, retryable) => {
    const error = await fetcherWith(
      () =>
        new Response(JSON.stringify({ error: 'Your account has run out of searches.' }), {
          status,
        }),
    )
      .fetch(request, new AbortController().signal)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GoogleShoppingUnavailableError);
    expect(error).toMatchObject({ retryable });
    expect(
      JSON.stringify({ ...(error as object), message: (error as Error).message }),
    ).not.toContain('SECRET-KEY');
  });

  it('JSON inválido -> GoogleShoppingParseError', async () => {
    await expect(
      fetcherWith(() => new Response('<html>')).fetch(request, new AbortController().signal),
    ).rejects.toBeInstanceOf(GoogleShoppingParseError);
  });

  it('falha de rede -> erro retentável sem a URL (que tem a chave)', async () => {
    const fetcher = new GoogleShoppingSerpApiFetcher({
      apiKey: 'SECRET-KEY',
      timeoutMs: 1_000,
      fetchFn: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
    });
    const error = await fetcher
      .fetch(request, new AbortController().signal)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ retryable: true });
    expect((error as GoogleShoppingScraperError).reason).not.toContain('SECRET-KEY');
  });
});

describe('GoogleShoppingBrowserFetcher', () => {
  /** BrowserPool falso: uma "página" com URL final/status/HTML controlados. */
  function fakeBrowser(page: { finalUrl: string; status: number; html: string }) {
    const opened = { pages: 0, closed: 0 };
    const pool = {
      async withPage<T>(_options: unknown, task: (p: unknown) => Promise<T>): Promise<T> {
        opened.pages++;
        try {
          return await task({
            goto: async () => ({ status: () => page.status }),
            url: () => page.finalUrl,
            waitForSelector: async () => null,
            content: async () => page.html,
          });
        } finally {
          opened.closed++;
        }
      },
    } as unknown as BrowserPool;
    return { pool, opened };
  }
  const request = buildRequest('camiseta preta', MARKET);
  const options = { userAgent: 'test', navigationTimeoutMs: 1_000, selectorTimeoutMs: 1_000 };

  it('devolve o HTML e a origem, e fecha a página', async () => {
    const { pool, opened } = fakeBrowser({
      finalUrl: 'https://www.google.com.br/search?q=x',
      status: 200,
      html: '<html>ok</html>',
    });
    const result = await new GoogleShoppingBrowserFetcher({ browser: pool, ...options }).fetch(
      request,
      new AbortController().signal,
    );
    expect(result.payload).toEqual({
      html: '<html>ok</html>',
      baseUrl: 'https://www.google.com.br',
    });
    expect(Object.keys(result.timings)).toEqual(['browserMs', 'navigationMs', 'extractionMs']);
    expect(opened).toEqual({ pages: 1, closed: 1 });
  });

  it.each([
    ['https://www.google.com/sorry/index?continue=x', 200],
    ['https://www.google.com.br/search?q=x', 429],
  ])('redirecionamento pro CAPTCHA / 429 -> bloqueado (%s, %i)', async (finalUrl, status) => {
    const { pool, opened } = fakeBrowser({ finalUrl, status, html: '' });
    await expect(
      new GoogleShoppingBrowserFetcher({ browser: pool, ...options }).fetch(
        request,
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(GoogleShoppingBlockedError);
    expect(opened.closed).toBe(1);
  });
});
