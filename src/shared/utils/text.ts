/** Remove acentos/diacríticos: "Calça Básica" -> "Calca Basica". */
export function removeAccents(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Minúsculo, sem acentos, só letras/números separados por um espaço. */
export function normalizeText(value: string): string {
  return removeAccents(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Colapsa espaços e remove espaços nas pontas. */
export function cleanWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** "camisa masculina PRETA" -> "Camisa Masculina Preta" (preposições curtas em minúsculo). */
export function toTitleCase(value: string): string {
  const lowerWords = new Set([
    'de',
    'da',
    'do',
    'das',
    'dos',
    'e',
    'com',
    'em',
    'no',
    'na',
    'nos',
    'nas',
    'para',
    'sem',
  ]);
  return cleanWhitespace(value)
    .toLowerCase()
    .split(' ')
    .map((word, index) =>
      index > 0 && lowerWords.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(' ');
}
