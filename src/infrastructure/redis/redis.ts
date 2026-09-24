import { Redis, type RedisOptions } from 'ioredis';
import { env } from '../../config/env.js';

/**
 * Cria uma conexão Redis. BullMQ exige `maxRetriesPerRequest: null` em conexões de worker,
 * por isso cada consumidor cria a sua própria conexão com as opções adequadas.
 */
export function createRedisConnection(options: RedisOptions = {}): Redis {
  return new Redis(env.REDIS_URL, {
    lazyConnect: true,
    enableReadyCheck: true,
    ...options,
  });
}

/** Conexão usada por cache e locks. Falha rápido para não travar requisições HTTP. */
export const redis = createRedisConnection({ maxRetriesPerRequest: 2, connectTimeout: 5_000 });

export async function connectRedis(): Promise<void> {
  if (redis.status === 'wait') await redis.connect();
}

export async function disconnectRedis(): Promise<void> {
  if (redis.status !== 'end') await redis.quit();
}

export async function pingRedis(): Promise<void> {
  await redis.ping();
}
