export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends AppError {
  constructor(code: string, message: string) {
    super(404, code, message);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, 'VALIDATION_ERROR', message, details);
  }
}

export class ConflictError extends AppError {
  constructor(code: string, message: string) {
    super(409, code, message);
  }
}

export class ExternalServiceError extends AppError {
  constructor(message: string, details?: unknown) {
    super(502, 'EXTERNAL_SERVICE_ERROR', message, details);
  }
}

/**
 * Erro de crawler. `retryable = false` indica que repetir o job não adianta
 * (ex.: fonte sem implementação, estrutura da página mudou).
 */
export class CrawlerError extends AppError {
  constructor(
    message: string,
    readonly retryable = true,
    details?: unknown,
  ) {
    super(502, 'CRAWLER_ERROR', message, details);
  }
}
