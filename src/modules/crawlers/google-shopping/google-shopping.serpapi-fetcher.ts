import {
  GoogleShoppingParseError,
  GoogleShoppingUnavailableError,
  toGoogleShoppingError,
} from './google-shopping.errors.js';
import type {
  FetchResult,
  GoogleShoppingFetcher,
  GoogleShoppingRequest,
} from './google-shopping.types.js';
import { buildSerpApiUrl } from './google-shopping.url.js';

export interface SerpApiFetcherOptions {
  apiKey: string;
  /** Tempo máximo de uma chamada (ms). */
  timeoutMs: number;
  /** Permite injetar um fetch falso nos testes. */
  fetchFn?: typeof fetch;
}

/**
 * Busca os resultados do Google Shopping pela SerpApi (API paga e autorizada) e devolve o JSON
 * bruto. A URL leva a API key, então NENHUMA mensagem de erro daqui inclui a URL.
 */
export class GoogleShoppingSerpApiFetcher implements GoogleShoppingFetcher<unknown> {
  readonly name = 'serpapi';
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: SerpApiFetcherOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async fetch(request: GoogleShoppingRequest, signal: AbortSignal): Promise<FetchResult<unknown>> {
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await this.fetchFn(buildSerpApiUrl(request, this.options.apiKey), {
        headers: { accept: 'application/json' },
        signal: AbortSignal.any([signal, AbortSignal.timeout(this.options.timeoutMs)]),
      });
    } catch (error) {
      throw toGoogleShoppingError(error);
    }
    const body = await response.text();
    const timings = { requestMs: Date.now() - startedAt };

    if (!response.ok) throw statusError(response.status, body);
    try {
      return { payload: JSON.parse(body) as unknown, timings };
    } catch {
      throw new GoogleShoppingParseError('SerpApi returned invalid JSON');
    }
  }
}

/**
 * 401/403 = chave inválida, 429 = cota do plano esgotada (ou limite por hora): repetir não
 * resolve. 5xx = falha passageira da SerpApi.
 */
function statusError(status: number, body: string): GoogleShoppingUnavailableError {
  const detail = serpApiErrorText(body);
  const reason = `serpapi HTTP ${status}${detail ? `: ${detail}` : ''}`;
  return new GoogleShoppingUnavailableError(reason, status >= 500);
}

function serpApiErrorText(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    return typeof parsed.error === 'string' ? parsed.error.slice(0, 200) : undefined;
  } catch {
    return undefined;
  }
}
