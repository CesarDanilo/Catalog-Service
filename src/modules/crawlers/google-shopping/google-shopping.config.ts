import type { Env } from '../../../config/env.js';
import type { GoogleShoppingMarket } from './google-shopping.types.js';

export type GoogleShoppingFetcherKind = Env['GOOGLE_SHOPPING_FETCHER'];

/** Toda a configuração do provider, lida uma vez do env (config/env.ts valida os valores). */
export interface GoogleShoppingConfig {
  fetcher: GoogleShoppingFetcherKind;
  serpApiKey?: string;
  defaultMarket: GoogleShoppingMarket;
  /** Moeda assumida quando o preço não traz símbolo reconhecível. */
  defaultCurrency: string;
  maxConcurrency: number;
  maxQueue: number;
  requestDelayMs: number;
  /** Busca inteira (fila + tentativas + extração). */
  timeoutMs: number;
  navigationTimeoutMs: number;
  selectorTimeoutMs: number;
  maxAttempts: number;
  maxProducts: number;
}

export function googleShoppingConfigFromEnv(env: Env): GoogleShoppingConfig {
  return {
    fetcher: env.GOOGLE_SHOPPING_FETCHER,
    serpApiKey: env.GOOGLE_SHOPPING_SERPAPI_KEY,
    defaultMarket: {
      country: env.GOOGLE_SHOPPING_COUNTRY,
      language: env.GOOGLE_SHOPPING_LANGUAGE,
      domain: env.GOOGLE_SHOPPING_DOMAIN,
    },
    defaultCurrency: env.GOOGLE_SHOPPING_CURRENCY,
    maxConcurrency: env.GOOGLE_SHOPPING_MAX_CONCURRENCY,
    maxQueue: env.GOOGLE_SHOPPING_MAX_QUEUE,
    requestDelayMs: env.GOOGLE_SHOPPING_REQUEST_DELAY_MS,
    timeoutMs: env.GOOGLE_SHOPPING_TIMEOUT_MS,
    navigationTimeoutMs: env.GOOGLE_SHOPPING_NAVIGATION_TIMEOUT_MS,
    selectorTimeoutMs: env.GOOGLE_SHOPPING_SELECTOR_TIMEOUT_MS,
    maxAttempts: env.GOOGLE_SHOPPING_MAX_ATTEMPTS,
    maxProducts: env.GOOGLE_SHOPPING_MAX_PRODUCTS,
  };
}
