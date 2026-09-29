import { describe, expect, it } from 'vitest';
import { buildGoogleShoppingTestApp } from '../helpers/google-shopping.js';

/**
 * Carga local contra o pipeline real (rotas -> service -> provider -> parser) com o scraper
 * falso (fixtures). NUNCA dispara nada contra o Google. Procura: páginas "abertas" acima do
 * limite, recursos não liberados, respostas 500, crescimento de memória.
 */

const URL = '/api/v1/providers/google-shopping/search';
const ALLOWED_STATUS = new Set([200, 429, 503]);

describe('carga local no endpoint do Google Shopping (mockado)', () => {
  it.each([10, 50, 100])(
    '%i requisições simultâneas: concorrência limitada, sem vazamento nem 500',
    async (total) => {
      const { app, fetcher } = await buildGoogleShoppingTestApp({ maxConcurrency: 1, maxQueue: 5 });
      fetcher.delayMs = 5;
      try {
        const heapBefore = process.memoryUsage().heapUsed;
        const responses = await Promise.all(
          Array.from({ length: total }, (_, i) =>
            app.inject({
              method: 'GET',
              url: URL,
              // Termos diferentes (sem ajuda do cache) e IPs diferentes (sem o rate limit por IP).
              query: { q: `camiseta ${i % 20}` },
              remoteAddress: `10.0.${Math.floor(i / 250)}.${i % 250}`,
            }),
          ),
        );

        const statuses = responses.map((response) => response.statusCode);
        expect(statuses.filter((status) => !ALLOWED_STATUS.has(status))).toEqual([]);
        expect(statuses).toContain(200);
        // Nunca mais "páginas" abertas ao mesmo tempo que o limite; todas fechadas no fim.
        expect(fetcher.peakOpenPages).toBe(1);
        expect(fetcher.openPages).toBe(0);
        // Idas à fonte limitadas pelos termos distintos (buscas iguais simultâneas compartilham).
        expect(fetcher.calls).toBeLessThanOrEqual(20);
        // Excesso vira 503 controlado (fila cheia), não fila infinita.
        for (const response of responses.filter((r) => r.statusCode === 503)) {
          expect(response.json().error.code).toBe('GOOGLE_SHOPPING_UNAVAILABLE');
        }
        const heapGrowthMb = (process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024;
        expect(heapGrowthMb).toBeLessThan(100);
      } finally {
        await app.close();
      }
    },
  );

  it('um único IP não consegue disparar buscas ilimitadas (rate limit da rota)', async () => {
    const { app, fetcher } = await buildGoogleShoppingTestApp({ maxQueue: 50 });
    try {
      const responses = [];
      for (let i = 0; i < 35; i++) {
        responses.push(await app.inject({ method: 'GET', url: URL, query: { q: `termo ${i}` } }));
      }
      const limited = responses.filter((response) => response.statusCode === 429);
      expect(limited.length).toBeGreaterThan(0);
      expect(fetcher.calls).toBeLessThanOrEqual(30);
    } finally {
      await app.close();
    }
  });
});
