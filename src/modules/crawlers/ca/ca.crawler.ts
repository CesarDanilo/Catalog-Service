import type { HttpClient } from '../shared/http-client.js';
import { VtexCrawler } from '../vtex/vtex.crawler.js';
import { CA_STORE } from '../vtex/vtex.stores.js';

export const CA_DEFAULT_BASE_URL = CA_STORE.baseUrl;
/** Caminhos de categoria sincronizados por padrão (sobrescreva com Source.config.categories). */
export const CA_DEFAULT_CATEGORIES = CA_STORE.defaultCategories ?? [];

/**
 * C&A — loja VTEX (catálogo público JSON, ver VtexCrawler). Mantida como classe pra quem já a
 * instancia direto (testes, scripts); o registro usa VTEX_STORES.
 */
export class CACrawler extends VtexCrawler {
  constructor(http: HttpClient, baseUrl = CA_DEFAULT_BASE_URL) {
    super(http, { ...CA_STORE, baseUrl });
  }
}
