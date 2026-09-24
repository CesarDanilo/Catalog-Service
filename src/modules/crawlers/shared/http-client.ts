import { CrawlerError } from '../../../shared/errors/app-error.js';
import { sleep } from '../../../shared/utils/sleep.js';

export interface HttpClientOptions {
  userAgent: string;
  timeoutMs: number;
  maxRetries: number;
  /** Intervalo mínimo entre requisições deste cliente (rate limit por fonte). */
  minDelayMs: number;
  /** Permite injetar um fetch falso nos testes. */
  fetchFn?: typeof fetch;
}

/** A fonte negou acesso (bloqueio/anti-bot/login). Interrompe o crawl — nunca é contornado. */
export class AccessDeniedError extends CrawlerError {
  constructor(url: string, status: number) {
    super(
      `Access denied (${status}) for ${url}. Blocked or requires authentication — not bypassing.`,
      false,
      { status },
    );
  }
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_RETRY_AFTER_MS = 60_000;

/**
 * Cliente HTTP "educado" para crawlers:
 * - uma requisição por vez por fonte, com intervalo mínimo entre elas;
 * - timeout por requisição;
 * - retry com backoff exponencial apenas para erros transitórios (5xx, 429, rede);
 * - 401/403 e desafios anti-bot NÃO são contornados: viram erro não-retentável.
 */
export class HttpClient {
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: HttpClientOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async getText(url: string, headers: Record<string, string> = {}): Promise<string> {
    const response = await this.request(url, {
      accept: 'text/html,application/xhtml+xml',
      ...headers,
    });
    return response.text;
  }

  async getJson<T = unknown>(url: string): Promise<{ data: T; headers: Headers }> {
    const response = await this.request(url, { accept: 'application/json' });
    try {
      return { data: JSON.parse(response.text) as T, headers: response.headers };
    } catch {
      throw new CrawlerError(`Invalid JSON from ${url}`, false);
    }
  }

  private request(url: string, headers: Record<string, string>) {
    // Serializa as requisições deste cliente para respeitar o intervalo mínimo.
    const run = this.queue.then(() => this.requestWithRetry(url, headers));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async requestWithRetry(url: string, headers: Record<string, string>) {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.options.maxRetries; attempt++) {
      await this.waitForSlot();
      try {
        const response = await this.fetchFn(url, {
          headers: {
            'user-agent': this.options.userAgent,
            'accept-language': 'pt-BR,pt;q=0.9',
            ...headers,
          },
          signal: AbortSignal.timeout(this.options.timeoutMs),
          redirect: 'follow',
        });

        if (response.ok) return { text: await response.text(), headers: response.headers };

        if (response.status === 401 || response.status === 403) {
          throw new AccessDeniedError(url, response.status);
        }
        if (response.status === 404) throw new CrawlerError(`Not found (404): ${url}`, false);
        if (!RETRYABLE_STATUS.has(response.status)) {
          throw new CrawlerError(`Unexpected status ${response.status} for ${url}`, false);
        }

        lastError = new CrawlerError(`Status ${response.status} for ${url}`);
        await sleep(this.backoffMs(attempt, response.headers.get('retry-after')));
      } catch (error) {
        if (error instanceof CrawlerError && !error.retryable) throw error;
        lastError = error;
        if (attempt < this.options.maxRetries) await sleep(this.backoffMs(attempt, null));
      }
    }

    const reason = lastError instanceof Error ? lastError.message : String(lastError);
    throw new CrawlerError(`Request failed after ${this.options.maxRetries} attempts: ${reason}`);
  }

  private async waitForSlot(): Promise<void> {
    const wait = this.lastRequestAt + this.options.minDelayMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = Date.now();
  }

  private backoffMs(attempt: number, retryAfter: string | null): number {
    const retryAfterSeconds = retryAfter ? Number(retryAfter) : NaN;
    if (Number.isFinite(retryAfterSeconds))
      return Math.min(retryAfterSeconds * 1000, MAX_RETRY_AFTER_MS);
    return Math.min(1_000 * 2 ** (attempt - 1), MAX_RETRY_AFTER_MS);
  }
}
