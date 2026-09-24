import { normalizeText } from '../../shared/utils/text.js';
import { COLOR_KEYWORDS, GENDER_KEYWORDS } from '../crawlers/normalizer/dictionaries.js';

const STOPWORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'com', 'para', 'e', 'em', 'a', 'o']);

/**
 * Converte o texto digitado em termos comparáveis com `Product.searchText`:
 * - sem acentos e minúsculo ("Calça" -> "calca");
 * - cor e gênero viram o valor canônico ("preta" -> "preto", "masculina" -> "masculino");
 * - plural simples removido ("camisas" -> "camisa"), de modo que singular e plural casam.
 */
export function toSearchTerms(query: string): string[] {
  const terms = normalizeText(query)
    .split(' ')
    .filter((token) => token && !STOPWORDS.has(token))
    .map((token) => {
      const singular = token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token;
      return canonical(token) ?? canonical(singular) ?? singular;
    });
  return [...new Set(terms)];
}

function canonical(token: string): string | undefined {
  return COLOR_KEYWORDS[token] ?? GENDER_KEYWORDS[token];
}
