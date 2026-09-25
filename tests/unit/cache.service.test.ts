import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import {
  RedisCacheService,
  cacheKeys,
  hashFilters,
} from '../../src/infrastructure/redis/cache.service.js';

function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => void store.set(key, value)),
    del: vi.fn(async (...keys: string[]) => keys.forEach((key) => store.delete(key))),
  };
}

describe('hashFilters / cacheKeys', () => {
  it('é estável independente da ordem das chaves e ignora vazios', () => {
    expect(hashFilters({ q: 'camisa', page: 1, color: undefined })).toBe(
      hashFilters({ page: 1, q: 'camisa', brand: '' }),
    );
    expect(hashFilters({ q: 'camisa' })).not.toBe(hashFilters({ q: 'vestido' }));
    expect(cacheKeys.product('abc')).toBe('catalog:product:abc');
    expect(cacheKeys.search({ q: 'x' })).toMatch(/^catalog:search:0:[a-f0-9]{32}$/);
    expect(cacheKeys.search({ q: 'x' }, 7)).toMatch(/^catalog:search:7:[a-f0-9]{32}$/);
  });
});

describe('RedisCacheService', () => {
  it('getOrSet chama o loader só no miss e grava com TTL', async () => {
    const redis = fakeRedis();
    const cache = new RedisCacheService(redis as unknown as Redis);
    const loader = vi.fn(async () => ({ value: 1 }));

    expect(await cache.getOrSet('k', 60, loader)).toEqual({ value: 1 });
    expect(await cache.getOrSet('k', 60, loader)).toEqual({ value: 1 });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith('k', '{"value":1}', 'EX', 60);
  });

  it('não grava null (ex.: produto inexistente)', async () => {
    const redis = fakeRedis();
    const cache = new RedisCacheService(redis as unknown as Redis);
    await cache.getOrSet('k', 60, async () => null);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('degrada para o loader quando o Redis falha', async () => {
    const broken = {
      get: vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
      set: vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    };
    const warn = vi.fn();
    const cache = new RedisCacheService(broken as unknown as Redis, { warn });
    await expect(cache.getOrSet('k', 60, async () => 'db')).resolves.toBe('db');
    expect(warn).toHaveBeenCalled();
  });

  it('del remove chaves', async () => {
    const redis = fakeRedis();
    redis.store.set('a', '1');
    await new RedisCacheService(redis as unknown as Redis).del('a');
    expect(redis.store.has('a')).toBe(false);
  });
});
