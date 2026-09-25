import { describe, expect, it } from 'vitest';
import type { ScrapedProduct } from '../../src/modules/crawlers/crawler.types.js';
import {
  ProductNormalizationError,
  normalizeCategory,
  normalizeColor,
  normalizeGender,
  normalizeProduct,
  normalizeUrl,
} from '../../src/modules/crawlers/normalizer/product.normalizer.js';

const base: ScrapedProduct = {
  externalId: '123',
  name: 'camisa masculina de linho preta',
  price: 129.9,
  currency: 'brl',
  productUrl: 'https://loja.example/p/123',
  available: true,
};

describe('normalizeGender', () => {
  it.each([
    ['Camisa Masculina', 'masculino'],
    ['Vestido Feminino', 'feminino'],
    ['Blusa mulher', 'feminino'],
    ['Camiseta Unissex', 'unissex'],
    ['Conjunto Infantil Menina', 'infantil'],
    ['Tênis masculino e feminino', 'unissex'],
    ['Camisetas Masculinas Kit 3', 'masculino'],
    ['Blusas Femininas', 'feminino'],
    ['Tênis Adidas VL Court Base Mascuino ID3712 Preto', 'masculino'],
  ])('%s -> %s', (text, expected) => {
    expect(normalizeGender(text)).toBe(expected);
  });

  it('usa o primeiro texto que tiver informação (campo explícito antes do nome)', () => {
    expect(normalizeGender(undefined, 'Camisa Masculina')).toBe('masculino');
    expect(normalizeGender('Feminino', 'Camisa Masculina')).toBe('feminino');
  });

  it('retorna null quando não identifica', () => {
    expect(normalizeGender('Sandália Bege')).toBeNull();
  });
});

describe('normalizeColor', () => {
  it.each([
    ['Camisa Preta', 'preto'],
    ['Camiseta Off White', 'off-white'],
    ['Sandália Azul Marinho', 'azul'],
    ['Calça Cinza Mescla', 'cinza'],
    ['Blusa Bordô', 'vinho'],
  ])('%s -> %s', (text, expected) => {
    expect(normalizeColor(text)).toBe(expected);
  });

  it('prioriza a cor explícita da fonte', () => {
    expect(normalizeColor('Branco', 'Camisa Preta')).toBe('branco');
  });
});

describe('normalizeCategory', () => {
  it.each([
    ['Saída de Praia Blusa em Tricô', 'moda-praia'],
    ['Blusa de Moletom', 'blusas'],
    ['Camisa Polo', 'camisas'],
    ['Camiseta Básica', 'camisetas'],
    ['Calça Jeans Wide Leg', 'calcas'],
    ['Vestido Longo', 'vestidos'],
    ['Body Splash Morango', null],
    ['Perfume La Vie Est Belle', null],
    ['Boneco Funko Pop', null],
  ])('%s -> %s', (text, expected) => {
    expect(normalizeCategory(text)).toBe(expected);
  });

  it('usa o caminho de categoria da fonte quando o nome não ajuda', () => {
    expect(normalizeCategory('Peça Especial', '/Moda Feminina/Roupas/Vestidos/')).toBe('vestidos');
  });
});

describe('normalizeUrl', () => {
  it('completa URLs sem protocolo e rejeita protocolos inválidos', () => {
    expect(normalizeUrl('//img.example/a.jpg')).toBe('https://img.example/a.jpg');
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('not a url')).toBeNull();
  });
});

describe('normalizeProduct', () => {
  it('aplica todas as regras determinísticas', () => {
    const result = normalizeProduct({
      ...base,
      brand: '  Basics ',
      size: 'm',
      originalPrice: 159.9,
      imageUrl: '//img.example/1.jpg',
      images: ['//img.example/1.jpg', 'https://img.example/2.jpg'],
    });

    expect(result).toMatchObject({
      name: 'Camisa Masculina de Linho Preta',
      slug: 'camisa-masculina-de-linho-preta',
      brand: 'Basics',
      gender: 'masculino',
      color: 'preto',
      categorySlug: 'camisas',
      size: 'M',
      price: 129.9,
      originalPrice: 159.9,
      currency: 'BRL',
      imageUrl: 'https://img.example/1.jpg',
      images: ['https://img.example/1.jpg', 'https://img.example/2.jpg'],
      available: true,
    });
    expect(result.searchText).toBe('camisa masculina de linho preta basics preto masculino');
  });

  it('descarta originalPrice que não é maior que o preço', () => {
    expect(normalizeProduct({ ...base, originalPrice: 129.9 }).originalPrice).toBeNull();
  });

  it('remove HTML da descrição', () => {
    const result = normalizeProduct({ ...base, description: '<p>Tecido <b>leve</b></p>' });
    expect(result.description).toBe('Tecido leve');
  });

  it.each([
    [{ externalId: ' ' }, 'externalId'],
    [{ name: '' }, 'name'],
    [{ price: 0 }, 'price'],
    [{ productUrl: 'ftp://x' }, 'productUrl'],
  ])('rejeita produto inválido (%o)', (override, field) => {
    expect(() => normalizeProduct({ ...base, ...override } as ScrapedProduct)).toThrow(
      ProductNormalizationError,
    );
    expect(() => normalizeProduct({ ...base, ...override } as ScrapedProduct)).toThrow(
      new RegExp(field, 'i'),
    );
  });
});
