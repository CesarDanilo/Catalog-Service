import { CrawlerError, ValidationError } from '../../../shared/errors/app-error.js';

/**
 * Erros do Google Shopping. A `message` vai para o cliente da API, então é sempre genérica;
 * o motivo técnico fica em `reason`, que só aparece nos logs (nunca HTML, URL com chave, cookies).
 */
export class GoogleShoppingScraperError extends CrawlerError {
  override readonly code: string = 'GOOGLE_SHOPPING_ERROR';

  constructor(
    readonly reason: string,
    retryable = false,
    message = 'Google Shopping search failed.',
  ) {
    super(message, retryable);
  }
}

/** CAPTCHA / "tráfego incomum" / 429. Nunca é repetido nem contornado. */
export class GoogleShoppingBlockedError extends GoogleShoppingScraperError {
  override readonly statusCode: number = 503;
  override readonly code: string = 'GOOGLE_SHOPPING_BLOCKED';

  constructor(reason: string) {
    super(reason, false, 'Google Shopping refused automated access. Try again later.');
  }
}

/** A busca passou do tempo máximo. Passageiro: pode ser repetido dentro do limite de tentativas. */
export class GoogleShoppingTimeoutError extends GoogleShoppingScraperError {
  override readonly statusCode: number = 504;
  override readonly code: string = 'GOOGLE_SHOPPING_TIMEOUT';

  constructor(reason: string) {
    super(reason, true, 'Google Shopping took too long to respond.');
  }
}

/** A resposta chegou mas não tem a estrutura esperada (layout/API mudou). */
export class GoogleShoppingParseError extends GoogleShoppingScraperError {
  override readonly code: string = 'GOOGLE_SHOPPING_PARSE_ERROR';

  constructor(reason: string) {
    super(reason, false, 'Google Shopping returned an unexpected response.');
  }
}

/** Desligado, sem cota, fila cheia, rede/5xx. `retryable` diz se tentar de novo pode ajudar. */
export class GoogleShoppingUnavailableError extends GoogleShoppingScraperError {
  override readonly statusCode: number = 503;
  override readonly code: string = 'GOOGLE_SHOPPING_UNAVAILABLE';

  constructor(reason: string, retryable = false) {
    super(reason, retryable, 'Google Shopping is temporarily unavailable.');
  }
}

export class GoogleShoppingInvalidRequestError extends ValidationError {
  constructor(reason: string) {
    super(`Invalid Google Shopping search: ${reason}`);
  }
}

/** Qualquer falha vira um erro desta família (ou é repassada, se já for). */
export function toGoogleShoppingError(error: unknown): GoogleShoppingScraperError {
  if (error instanceof GoogleShoppingScraperError) return error;
  const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (error instanceof Error && error.name === 'TimeoutError') {
    return new GoogleShoppingTimeoutError(reason);
  }
  // Ex.: Chromium não instalado (CrawlerError não-retentável do BrowserPool).
  if (error instanceof CrawlerError)
    return new GoogleShoppingUnavailableError(reason, error.retryable);
  return new GoogleShoppingUnavailableError(reason, true);
}
