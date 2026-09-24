import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

export interface Lock {
  release(): Promise<void>;
}

/** Lock distribuído simples (SET NX PX). Suficiente para uma instância de Redis. */
export class LockService {
  constructor(private readonly redis: Redis) {}

  async acquire(key: string, ttlMs: number): Promise<Lock | null> {
    const token = randomUUID();
    const result = await this.redis.set(key, token, 'PX', ttlMs, 'NX');
    if (result !== 'OK') return null;
    return {
      release: async () => {
        await this.redis.eval(RELEASE_SCRIPT, 1, key, token);
      },
    };
  }
}
