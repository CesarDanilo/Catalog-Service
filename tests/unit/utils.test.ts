import { describe, expect, it } from 'vitest';
import { parsePrice } from '../../src/shared/utils/price.js';
import { sortSizes } from '../../src/shared/utils/sizes.js';
import { slugify } from '../../src/shared/utils/slug.js';
import { normalizeText, toTitleCase } from '../../src/shared/utils/text.js';
import { buildPaginationMeta, toOffset } from '../../src/shared/utils/pagination.js';

describe('slugify', () => {
  it('gera slug consistente', () => {
    expect(slugify('Camisa Masculina Preta Slim')).toBe('camisa-masculina-preta-slim');
  });

  it('remove acentos, símbolos e espaços extras', () => {
    expect(slugify('  Calça  Jeans – Básica (C&A) ')).toBe('calca-jeans-basica-c-a');
  });

  it('limita o tamanho sem terminar em hífen', () => {
    const slug = slugify('palavra '.repeat(40));
    expect(slug.length).toBeLessThanOrEqual(120);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('normalizeText / toTitleCase', () => {
  it('normaliza para minúsculo sem acento', () => {
    expect(normalizeText('Saída de Praia TRICÔ')).toBe('saida de praia trico');
  });

  it('capitaliza mantendo preposições em minúsculo', () => {
    expect(toTitleCase('calça de alfaiataria com elástico no cós')).toBe(
      'Calça de Alfaiataria com Elástico no Cós',
    );
  });
});

describe('parsePrice', () => {
  it.each([
    [139.9, 139.9],
    ['139.90', 139.9],
    ['139,90', 139.9],
    ['R$ 1.299,90', 1299.9],
    ['1,299.90', 1299.9],
    [10.005, 10.01],
  ])('%s -> %s', (input, expected) => {
    expect(parsePrice(input)).toBe(expected);
  });

  it.each([[undefined], [null], ['abc'], [-5], [Number.NaN]])('inválido: %s', (input) => {
    expect(parsePrice(input)).toBeNull();
  });
});

describe('sortSizes', () => {
  it('ordena letras e números naturalmente e remove duplicados', () => {
    expect(sortSizes(['GG', 'P', 'M', 'PP', 'G', 'M'])).toEqual(['PP', 'P', 'M', 'G', 'GG']);
    expect(sortSizes(['46', '38', '40', '44'])).toEqual(['38', '40', '44', '46']);
  });
});

describe('pagination', () => {
  it('calcula offset e metadados', () => {
    expect(toOffset({ page: 3, pageSize: 20 })).toEqual({ skip: 40, take: 20 });
    expect(buildPaginationMeta({ page: 1, pageSize: 20 }, 41)).toEqual({
      page: 1,
      pageSize: 20,
      total: 41,
      totalPages: 3,
    });
  });
});
