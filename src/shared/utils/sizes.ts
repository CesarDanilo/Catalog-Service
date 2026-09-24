const LETTER_SIZES = [
  'RN',
  'PP',
  'P',
  'M',
  'G',
  'GG',
  'XG',
  'XGG',
  'EG',
  'EGG',
  'G1',
  'G2',
  'G3',
  'G4',
];

function rank(size: string): [number, number] {
  const letter = LETTER_SIZES.indexOf(size.toUpperCase());
  if (letter >= 0) return [0, letter];
  const numeric = Number(size.replace(',', '.'));
  if (Number.isFinite(numeric)) return [1, numeric];
  return [2, 0];
}

/** Ordena tamanhos de forma natural: PP, P, M, G, GG... e numéricos em ordem crescente. */
export function sortSizes(sizes: string[]): string[] {
  return [...new Set(sizes)].sort((a, b) => {
    const [groupA, valueA] = rank(a);
    const [groupB, valueB] = rank(b);
    return groupA - groupB || valueA - valueB || a.localeCompare(b);
  });
}
