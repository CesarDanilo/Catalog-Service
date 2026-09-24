import { describe, expect, it } from 'vitest';
import { toSearchTerms } from '../../src/modules/products/product.search.js';

describe('toSearchTerms', () => {
  it('normaliza acentos, sinônimos de cor/gênero e plural', () => {
    expect(toSearchTerms('Calças Pretas')).toEqual(['calca', 'preto']);
    expect(toSearchTerms('camisa preta')).toEqual(['camisa', 'preto']);
    expect(toSearchTerms('Vestido FEMININA')).toEqual(['vestido', 'feminino']);
  });

  it('remove stopwords e duplicados', () => {
    expect(toSearchTerms('camisa de linho com camisa')).toEqual(['camisa', 'linho']);
  });

  it('retorna vazio para texto sem termos', () => {
    expect(toSearchTerms(' !!! ')).toEqual([]);
  });
});
