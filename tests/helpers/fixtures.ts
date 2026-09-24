import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function readFixture(name: string): string {
  return readFileSync(join(import.meta.dirname, '..', 'fixtures', name), 'utf8');
}

export function readJsonFixture<T = unknown>(name: string): T {
  return JSON.parse(readFixture(name)) as T;
}

/** Cria um `fetch` falso que responde por URL (string exata ou RegExp). */
export function fakeFetch(
  routes: Array<[match: string | RegExp, response: () => Response]>,
): typeof fetch & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    const route = routes.find(([match]) =>
      typeof match === 'string' ? match === url : match.test(url),
    );
    if (!route) return new Response('not found', { status: 404 });
    return route[1]();
  }) as typeof fetch & { calls: string[] };
  fn.calls = calls;
  return fn;
}
