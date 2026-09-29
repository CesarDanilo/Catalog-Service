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
    ['Regata Masculina Dry Fit', 'regatas'],
    ['Moletom Canguru Cinza', 'moletons'],
    ['Blusa de Moletom', 'blusas'],
    ['Tênis Adidas Courtblock Branco', 'tenis'],
    ['Sapatênis Casual Couro', 'sapatos'],
    ['Bota Coturno Cano Curto', 'botas'],
    ['Sandália Rasteira Tiras', 'sandalias'],
    ['Chinelo Havaianas Slim', 'chinelos'],
    ['Sapatilha Bico Fino', 'sapatilhas'],
    ['Slide Nike Victori', 'slides'],
    ['Boné Aba Curva', 'bones'],
    ['Chapéu Bucket Jeans', 'chapeus'],
    ['Kit Bolsa Tiracolo Cinto Couro', 'bolsas'],
    ['Mochila Escolar Preta', 'mochilas'],
    ['Óculos de Sol Aviador', 'oculos'],
    ['Cinto de Couro Fivela', 'cintos'],
    ['Relógio Digital Esportivo', 'relogios'],
    ['Carteira Masculina Couro', 'carteiras'],
    ['Colar Dourado Corrente', 'bijuterias'],
    ['Joia Anel Prata 925', 'joias'],
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

  it('infantil no nome ou na categoria vence o gênero informado pela loja', () => {
    expect(
      normalizeProduct({
        ...base,
        name: 'Jaqueta Menino Em Moletom Malwee Kids',
        gender: 'Masculino',
      }).gender,
    ).toBe('infantil');
    expect(
      normalizeProduct({ ...base, gender: 'Feminino', category: '/Moda Infantil/Meninas/' }).gender,
    ).toBe('infantil');
    // Sem sinal infantil, o gênero da loja continua valendo.
    expect(normalizeProduct({ ...base, gender: 'Feminino' }).gender).toBe('feminino');
  });

  it('produto sem preço é recusado (não entra no catálogo)', () => {
    expect(() => normalizeProduct({ ...base, price: 0 })).toThrow(ProductNormalizationError);
    expect(() => normalizeProduct({ ...base, price: Number.NaN })).toThrow(
      ProductNormalizationError,
    );
  });

  it('produto sem imagem, sem categoria ou indisponível continua válido', () => {
    const result = normalizeProduct({ ...base, name: 'Peça Especial', available: false });
    expect(result.imageUrl).toBeNull();
    expect(result.images).toEqual([]);
    expect(result.categorySlug).toBeNull();
    expect(result.available).toBe(false);
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
