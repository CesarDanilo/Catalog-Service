import { abortableSleep } from './concurrency-limiter.js';

export interface RetryOptions {
  /** Total de tentativas (inclui a primeira). */
  maxAttempts: number;
  /** Espera antes da 2ª tentativa; dobra a cada nova tentativa. */
  baseDelayMs: number;
  maxDelayMs?: number;
  /** Só erros para os quais isto retorna true são repetidos. */
  shouldRetry: (error: unknown) => boolean;
  signal?: AbortSignal;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

/** Repete `task` com backoff exponencial — número finito de tentativas, nunca em loop infinito. */
export async function retryWithBackoff<T>(
  task: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const maxDelayMs = options.maxDelayMs ?? 30_000;
  const maxAttempts = Math.max(1, options.maxAttempts);
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    options.signal?.throwIfAborted();
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts || !options.shouldRetry(error)) break;
      const delayMs = Math.min(options.baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      options.onRetry?.(error, attempt, delayMs);
      await abortableSleep(delayMs, options.signal);
    }
  }
  throw lastError;
}
