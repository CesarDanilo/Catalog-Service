import { normalizeText } from './text.js';

const MAX_SLUG_LENGTH = 120;

/** "Camisa Masculina Preta Slim" -> "camisa-masculina-preta-slim". */
export function slugify(value: string): string {
  return normalizeText(value).replace(/\s+/g, '-').slice(0, MAX_SLUG_LENGTH).replace(/-+$/, '');
}
