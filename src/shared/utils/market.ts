/** Formatos aceitos para mercado de busca — usados pela config, pela API e pelos providers. */

/** País ISO 3166-1 alpha-2 (BR, US, PT). */
export const COUNTRY_CODE = /^[A-Za-z]{2}$/;

/** Idioma: "pt", "pt-BR", "en-us". */
export const LANGUAGE_TAG = /^[a-z]{2}(-[A-Za-z]{2})?$/;

/** Só domínios do Google (google.com, google.com.br, google.pt). */
export const GOOGLE_DOMAIN = /^google(\.[a-z]{2,3}){1,2}$/;
