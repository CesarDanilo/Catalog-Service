import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';

export interface CacheLogger {
  warn(obj: object, msg: string): void;
}

export interface CacheService {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  del(...keys: string[]): Promise<void>;
  getOrSet<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T>;
}

export const CACHE_PREFIX = 'catalog';

export const cacheKeys = {
  product: (id: string) => `${CACHE_PREFIX}:product:${id}`,
  search: (filters: Record<string, unknown>) => `${CACHE_PREFIX}:search:${hashFilters(filters)}`,
  categories: () => `${CACHE_PREFIX}:categories`,
};

/** Hash estável: a ordem das chaves e valores vazios não alteram o resultado. */
export function hashFilters(filters: Record<string, unknown>): string {
  const normalized = Object.keys(filters)
    .sort()
    .filter((key) => filters[key] !== undefined && filters[key] !== null && filters[key] !== '')
    .map((key) => [key, filters[key]]);
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex').slice(0, 32);
}

/**
 * Cache em Redis. Erros do Redis nunca derrubam a requisição:
 * o cache é degradado para "miss" e o Postgres continua sendo a fonte de verdade.
 */
export class RedisCacheService implements CacheService {
  constructor(
    private readonly redis: Redis,
    private readonly logger?: CacheLogger,
  ) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch (error) {
      this.logger?.warn({ err: error, key }, 'cache get failed');
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      this.logger?.warn({ err: error, key }, 'cache set failed');
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await this.redis.del(...keys);
    } catch (error) {
      this.logger?.warn({ err: error, keys }, 'cache delete failed');
    }
  }

  async getOrSet<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;
    const value = await loader();
    if (value !== null && value !== undefined) await this.set(key, value, ttlSeconds);
    return value;
  }
}
