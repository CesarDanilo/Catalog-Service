import { sleep } from './sleep.js';

export interface ConcurrencyLimiterOptions {
  /** Tarefas rodando ao mesmo tempo. */
  maxConcurrent: number;
  /** Tarefas esperando a vez; acima disso `run` rejeita na hora com LimiterQueueFullError. */
  maxQueue: number;
  /** Intervalo mínimo entre o INÍCIO de duas tarefas (ms). */
  minIntervalMs: number;
}

export class LimiterQueueFullError extends Error {
  constructor() {
    super('Concurrency limiter queue is full');
    this.name = 'LimiterQueueFullError';
  }
}

interface Waiter {
  resolve: () => void;
  reject: (reason: unknown) => void;
}

/**
 * Limita quantas tarefas rodam ao mesmo tempo, espaça o início entre elas e recusa quando a
 * fila está cheia (em vez de acumular requisições sem limite). Em memória, por processo.
 */
export class ConcurrencyLimiter {
  private running = 0;
  private readonly waiters: Waiter[] = [];
  private nextStartAt = 0;

  constructor(private readonly options: ConcurrencyLimiterOptions) {}

  get active(): number {
    return this.running;
  }

  get queued(): number {
    return this.waiters.length;
  }

  async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(signal);
    try {
      await this.waitForStartSlot(signal);
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.running < this.options.maxConcurrent) {
      this.running++;
      return Promise.resolve();
    }
    if (this.waiters.length >= this.options.maxQueue) {
      return Promise.reject(new LimiterQueueFullError());
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        resolve: () => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        },
        reject,
      };
      const onAbort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(signal?.reason);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    // A vaga passa direto pro próximo da fila (running não muda).
    if (next) next.resolve();
    else this.running--;
  }

  private async waitForStartSlot(signal?: AbortSignal): Promise<void> {
    const now = Date.now();
    const startAt = Math.max(now, this.nextStartAt);
    this.nextStartAt = startAt + this.options.minIntervalMs;
    if (startAt > now) await abortableSleep(startAt - now, signal);
  }
}

/** `sleep` que termina antes (rejeitando) se o signal abortar. */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return sleep(ms);
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
