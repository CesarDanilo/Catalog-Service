/** Mercado de uma busca: país (ISO alpha-2), idioma e domínio do Google. */
export interface GoogleShoppingMarket {
  country: string;
  language: string;
  domain: string;
}

export interface GoogleShoppingRequest {
  /** Termo já limpo (espaços colapsados), com a grafia original. */
  query: string;
  market: GoogleShoppingMarket;
}

/**
 * Um resultado como a fonte o entrega, antes de virar ScrapedProduct.
 * Tudo opcional: o parser nunca inventa um campo que a página/API não trouxe.
 */
export interface RawGoogleShoppingProduct {
  /** Posição no resultado (1 = primeiro). */
  position: number;
  externalId?: string;
  title?: string;
  price?: number;
  currency?: string;
  imageUrl?: string;
  productUrl?: string;
  seller?: string;
  rating?: number;
  reviewCount?: number;
}

/** Tempos de cada etapa (ms), só pra log/medição. */
export type StageTimings = Record<string, number>;

export interface FetchResult<TPayload> {
  payload: TPayload;
  timings: StageTimings;
}

/**
 * Obtém os dados brutos de uma busca (HTML de uma página, JSON de uma API...).
 * Não interpreta nada: quem transforma em RawGoogleShoppingProduct é o parser do mesmo par.
 */
export interface GoogleShoppingFetcher<TPayload> {
  /** Nome curto pra logs (ex.: "serpapi", "browser"). */
  readonly name: string;
  fetch(request: GoogleShoppingRequest, signal: AbortSignal): Promise<FetchResult<TPayload>>;
}

export type GoogleShoppingParser<TPayload> = (payload: TPayload) => RawGoogleShoppingProduct[];
