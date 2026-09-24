import { describe, expect, it } from 'vitest';
import { AccessDeniedError, HttpClient } from '../../src/modules/crawlers/shared/http-client.js';
import { CrawlerError } from '../../src/shared/errors/app-error.js';

function client(
  fetchFn: typeof fetch,
  overrides: { minDelayMs?: number; maxRetries?: number } = {},
) {
  return new HttpClient({
    userAgent: 'CatalogServiceBot/test',
    timeoutMs: 1_000,
    maxRetries: overrides.maxRetries ?? 3,
    minDelayMs: overrides.minDelayMs ?? 0,
    fetchFn,
  });
}

describe('HttpClient', () => {
  it('envia User-Agent identificável', async () => {
    let userAgent: string | null = null;
    const fetchFn = (async (_url: string, init: RequestInit) => {
      userAgent = new Headers(init.headers).get('user-agent');
      return new Response('ok');
    }) as unknown as typeof fetch;
    await client(fetchFn).getText('https://x.test');
    expect(userAgent).toBe('CatalogServiceBot/test');
  });

  it('repete em erro transitório (503) e retorna o sucesso', async () => {
    let calls = 0;
    const fetchFn = (async () =>
      ++calls < 2
        ? new Response('busy', { status: 503, headers: { 'retry-after': '0' } })
        : new Response('ok')) as unknown as typeof fetch;
    await expect(client(fetchFn).getText('https://x.test')).resolves.toBe('ok');
    expect(calls).toBe(2);
  });

  it('não repete e não contorna 403', async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      return new Response('no', { status: 403 });
    }) as unknown as typeof fetch;
    await expect(client(fetchFn).getText('https://x.test')).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    expect(calls).toBe(1);
  });

  it('desiste após o número máximo de tentativas', async () => {
    const fetchFn = (async () => {
      throw new TypeError('network down');
    }) as unknown as typeof fetch;
    const error = await client(fetchFn, { maxRetries: 2 })
      .getText('https://x.test')
      .catch((e) => e);
    expect(error).toBeInstanceOf(CrawlerError);
    expect((error as CrawlerError).message).toMatch(/after 2 attempts/);
  });

  it('respeita o intervalo mínimo entre requisições', async () => {
    const times: number[] = [];
    const fetchFn = (async () => {
      times.push(Date.now());
      return new Response('ok');
    }) as unknown as typeof fetch;
    const http = client(fetchFn, { minDelayMs: 150 });
    await Promise.all([http.getText('https://x.test/1'), http.getText('https://x.test/2')]);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(140);
  });

  it('rejeita JSON inválido', async () => {
    const fetchFn = (async () => new Response('<html>')) as unknown as typeof fetch;
    await expect(client(fetchFn).getJson('https://x.test')).rejects.toThrow(/Invalid JSON/);
  });
});
