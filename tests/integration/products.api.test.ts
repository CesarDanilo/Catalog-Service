import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Container } from '../../src/container.js';
import type { ScrapedProduct } from '../../src/modules/crawlers/crawler.types.js';
import { normalizeProduct } from '../../src/modules/crawlers/normalizer/product.normalizer.js';
import { buildTestApp } from '../helpers/app.js';
import { closeConnections, prisma, resetDatabase, seedBasics } from '../helpers/db.js';

let app: FastifyInstance;
let container: Container;
let ids: Record<string, string>;

const scraped = (
  id: string,
  name: string,
  price: number,
  extra: Partial<ScrapedProduct> = {},
): ScrapedProduct => ({
  externalId: id,
  name,
  price,
  currency: 'BRL',
  productUrl: `https://loja.example/p/${id}`,
  imageUrl: `https://img.example/${id}.jpg`,
  available: true,
  ...extra,
});

beforeAll(async () => {
  ({ app, container } = await buildTestApp());
  await resetDatabase();
  const { sources, categories } = await seedBasics();
  const catIds = new Map([
    ['camisas', categories.camisas.id],
    ['vestidos', categories.vestidos.id],
    ['calcas', categories.calcas.id],
  ]);

  const save = async (sourceId: string, product: ScrapedProduct) => {
    const normalized = normalizeProduct(product);
    const categoryId = normalized.categorySlug
      ? (catIds.get(normalized.categorySlug) ?? null)
      : null;
    return container.services.products.saveScraped(sourceId, normalized, categoryId, new Date());
  };

  const results = await Promise.all([
    save(
      sources.renner.id,
      scraped('r1', 'Camisa Masculina Preta Slim', 129.9, {
        brand: 'Renner',
        rawData: { secret: 'raw' },
      }),
    ),
    save(
      sources.renner.id,
      scraped('r2', 'Vestido Longo Feminino Preto', 299.9, {
        brand: 'Renner',
        originalPrice: 399.9,
      }),
    ),
    save(
      sources.ca.id,
      scraped('c1', 'camisa feminina de linho branca', 89.9, { brand: 'Basics' }),
    ),
    save(
      sources.ca.id,
      scraped('c2', 'Calça Jeans Masculina Azul', 159.9, { brand: 'C&A', available: false }),
    ),
  ]);
  ids = { r1: results[0]!.id, r2: results[1]!.id, c1: results[2]!.id, c2: results[3]!.id };
});

afterAll(async () => {
  await app.close();
  await closeConnections();
});

async function list(query: string) {
  const response = await app.inject({ url: `/api/v1/products${query}` });
  expect(response.statusCode).toBe(200);
  return response.json() as {
    data: Array<Record<string, unknown>>;
    pagination: Record<string, number>;
  };
}

const names = (body: { data: Array<Record<string, unknown>> }) =>
  body.data.map((p) => p.name).sort();

describe('GET /api/v1/products', () => {
  it('lista com paginação e formato para o provador', async () => {
    const body = await list('?pageSize=2');
    expect(body.pagination).toEqual({ page: 1, pageSize: 2, total: 4, totalPages: 2 });
    expect(body.data[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        name: expect.any(String),
        price: expect.any(Number),
        currency: 'BRL',
        imageUrl: expect.any(String),
        productUrl: expect.any(String),
        source: expect.objectContaining({ name: expect.any(String), slug: expect.any(String) }),
      }),
    );
    expect(body.data[0]).not.toHaveProperty('rawData');
  });

  it.each([
    ['?gender=feminina', ['Camisa Feminina de Linho Branca', 'Vestido Longo Feminino Preto']],
    ['?color=preta', ['Camisa Masculina Preta Slim', 'Vestido Longo Feminino Preto']],
    ['?source=ca', ['Calça Jeans Masculina Azul', 'Camisa Feminina de Linho Branca']],
    ['?brand=renner', ['Camisa Masculina Preta Slim', 'Vestido Longo Feminino Preto']],
    ['?category=camisas', ['Camisa Feminina de Linho Branca', 'Camisa Masculina Preta Slim']],
    ['?minPrice=100&maxPrice=200', ['Calça Jeans Masculina Azul', 'Camisa Masculina Preta Slim']],
    ['?available=false', ['Calça Jeans Masculina Azul']],
    ['?q=vestido&gender=feminino&color=preto&maxPrice=300', ['Vestido Longo Feminino Preto']],
  ])('filtra %s', async (query, expected) => {
    expect(names(await list(query))).toEqual(expected);
  });

  it('includeNeutral: gênero aceita também peças unissex e sem gênero', async () => {
    const source = await prisma.source.findUniqueOrThrow({ where: { slug: 'renner' } });
    const neutral = await Promise.all(
      [
        scraped('n1', 'Tênis Casual Unissex Branco', 199.9),
        scraped('n2', 'Bolsa Tiracolo Couro Preta', 149.9),
        scraped('n3', 'Vestido Curto Feminino Azul', 99.9),
      ].map((product) =>
        container.services.products.saveScraped(
          source.id,
          normalizeProduct(product),
          null,
          new Date(),
        ),
      ),
    );
    try {
      const strict = names(await list('?gender=masculino'));
      expect(strict).not.toContain('Tênis Casual Unissex Branco');

      const loose = names(await list('?gender=masculino&includeNeutral=true'));
      expect(loose).toEqual(
        expect.arrayContaining(['Tênis Casual Unissex Branco', 'Bolsa Tiracolo Couro Preta']),
      );
      expect(loose).not.toContain('Vestido Curto Feminino Azul');

      const all = names(await list('?q=tenis'));
      expect(all).toContain('Tênis Casual Unissex Branco');
    } finally {
      await prisma.product.deleteMany({ where: { id: { in: neutral.map((n) => n.id) } } });
    }
  });

  it('excludeGender=infantil esconde peças infantis (e mantém as sem gênero)', async () => {
    const source = await prisma.source.findUniqueOrThrow({ where: { slug: 'ca' } });
    const saved = await Promise.all(
      [
        scraped('k1', 'Camiseta Infantil Menino Dino Azul', 39.9),
        scraped('k2', 'Camiseta Lisa Básica Cinza', 49.9),
      ].map((product) =>
        container.services.products.saveScraped(
          source.id,
          normalizeProduct(product),
          null,
          new Date(),
        ),
      ),
    );
    try {
      expect(names(await list('?q=camiseta'))).toContain('Camiseta Infantil Menino Dino Azul');
      const adults = names(await list('?q=camiseta&excludeGender=infantil'));
      expect(adults).not.toContain('Camiseta Infantil Menino Dino Azul');
      expect(adults).toContain('Camiseta Lisa Básica Cinza');
    } finally {
      await prisma.product.deleteMany({ where: { id: { in: saved.map((s) => s.id) } } });
    }
  });

  it('categoria pai inclui subcategorias', async () => {
    expect((await list('?category=roupas')).pagination.total).toBe(4);
    expect((await list('?category=inexistente')).pagination.total).toBe(0);
  });

  it.each([
    ['price_asc', [89.9, 129.9, 159.9, 299.9]],
    ['price_desc', [299.9, 159.9, 129.9, 89.9]],
  ])('ordena por %s', async (sort, prices) => {
    expect((await list(`?sort=${sort}`)).data.map((p) => p.price)).toEqual(prices);
  });

  it('valida parâmetros', async () => {
    for (const query of ['?pageSize=500', '?page=0', '?sort=price', '?minPrice=-1']) {
      const response = await app.inject({ url: `/api/v1/products${query}` });
      expect(response.statusCode, query).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('GET /api/v1/products/search', () => {
  it('busca sem acento, com sinônimos e plural', async () => {
    const search = (q: string) =>
      app
        .inject({ url: `/api/v1/products/search?q=${encodeURIComponent(q)}` })
        .then((r) => r.json());

    expect(names(await search('camisa preta'))).toEqual(['Camisa Masculina Preta Slim']);
    expect(names(await search('calcas'))).toEqual(['Calça Jeans Masculina Azul']);
    expect(names(await search('CAMISAS'))).toHaveLength(2);
    expect(names(await search('linho feminina'))).toEqual(['Camisa Feminina de Linho Branca']);
  });

  it('usa o mesmo formato de resposta da listagem', async () => {
    const body = (await app.inject({ url: '/api/v1/products/search?q=nada-encontrado' })).json();
    expect(body).toEqual({
      data: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    });
  });

  it('exige q', async () => {
    expect((await app.inject({ url: '/api/v1/products/search' })).statusCode).toBe(400);
  });
});

describe('GET /api/v1/products/:id', () => {
  it('retorna o detalhe com imagens, sem rawData', async () => {
    const response = await app.inject({ url: `/api/v1/products/${ids.r2}` });
    expect(response.statusCode).toBe(200);
    const { data } = response.json();
    expect(data).toMatchObject({
      id: ids.r2,
      name: 'Vestido Longo Feminino Preto',
      price: 299.9,
      originalPrice: 399.9,
      gender: 'feminino',
      color: 'preto',
      category: { slug: 'vestidos' },
      source: { slug: 'renner', name: 'Renner' },
      images: [{ url: 'https://img.example/r2.jpg', position: 0, cachedUrl: null }],
    });
    expect(data).not.toHaveProperty('rawData');
  });

  it('404 com código de erro padronizado', async () => {
    const response = await app.inject({
      url: '/api/v1/products/00000000-0000-4000-8000-000000000000',
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found' },
    });
  });

  it('atualização invalida o cache do produto', async () => {
    await app.inject({ url: `/api/v1/products/${ids.r1}` }); // popula o cache
    const source = await prisma.source.findUniqueOrThrow({ where: { slug: 'renner' } });
    await container.services.products.saveScraped(
      source.id,
      normalizeProduct(scraped('r1', 'Camisa Masculina Preta Slim', 99.9)),
      null,
      new Date(),
    );
    const { data } = (await app.inject({ url: `/api/v1/products/${ids.r1}` })).json();
    expect(data.price).toBe(99.9);
  });
});

describe('GET /api/v1/categories', () => {
  it('lista plana e em árvore', async () => {
    const flat = (await app.inject({ url: '/api/v1/categories' })).json();
    expect(flat.data).toHaveLength(4);

    const tree = (await app.inject({ url: '/api/v1/categories?tree=true' })).json();
    expect(tree.data).toHaveLength(1);
    expect(tree.data[0].children.map((c: { slug: string }) => c.slug).sort()).toEqual([
      'calcas',
      'camisas',
      'vestidos',
    ]);

    const children = (await app.inject({ url: '/api/v1/categories?parent=roupas' })).json();
    expect(children.data).toHaveLength(3);
    expect((await app.inject({ url: '/api/v1/categories?parent=x' })).statusCode).toBe(404);
  });
});

describe('busca: regressões', () => {
  it('"calca" não casa com calçados nem com o meio de outras palavras', async () => {
    const source = await prisma.source.findUniqueOrThrow({ where: { slug: 'ca' } });
    const { id } = await container.services.products.saveScraped(
      source.id,
      normalizeProduct(
        scraped('c9', 'Sapato Feminino Mocassim Preto', 129.9, { category: 'Calçados' }),
      ),
      null,
      new Date(),
    );
    try {
      const body = (await app.inject({ url: '/api/v1/products/search?q=calca' })).json();
      expect(names(body)).toEqual(['Calça Jeans Masculina Azul']);
      const partial = (await app.inject({ url: '/api/v1/products/search?q=lça' })).json();
      expect(partial.data).toEqual([]);
    } finally {
      await prisma.product.delete({ where: { id } });
    }
  });
});
