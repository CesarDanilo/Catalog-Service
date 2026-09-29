import type { VtexMappingOptions } from './vtex.mapper.js';

/** Uma loja VTEX: só configuração — o crawler é o mesmo pra todas (VtexCrawler). */
export interface VtexStore extends VtexMappingOptions {
  /** Slug da Source no banco. */
  source: string;
  baseUrl: string;
  /** Caminhos de categoria sincronizados por padrão (Source.config.categories sobrescreve). */
  defaultCategories?: string[];
  /** Termos sincronizados por padrão (Source.config.searchTerms sobrescreve). */
  defaultSearchTerms?: string[];
}

export const CA_STORE: VtexStore = {
  source: 'ca',
  baseUrl: 'https://www.cea.com.br',
  defaultCategories: ['moda-feminina/roupas', 'moda-masculina/roupas'],
};

/**
 * Lojas VTEX com o catálogo público liberado no robots.txt (verificado em 2026-09-29; ver
 * README → Fontes do catálogo). Loja nova da plataforma = uma entrada aqui + a Source no seed.
 * Farm, Animale e Lojas Torra também são VTEX, mas o robots.txt delas proíbe /api/ — não entram.
 */
export const VTEX_STORES: readonly VtexStore[] = [
  CA_STORE,
  { source: 'hering', baseUrl: 'https://www.hering.com.br' },
  { source: 'reserva', baseUrl: 'https://www.usereserva.com' },
  { source: 'malwee', baseUrl: 'https://www.malwee.com.br' },
  // Moda masculina: os produtos não trazem especificação de gênero.
  { source: 'aramis', baseUrl: 'https://www.aramis.com.br', defaultGender: 'masculino' },
  { source: 'mash', baseUrl: 'https://www.mash.com.br' },
  { source: 'lupo', baseUrl: 'https://www.lupo.com.br' },
];
