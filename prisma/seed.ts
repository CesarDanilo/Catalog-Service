import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Árvore inicial de categorias. O gênero é um campo do produto (não um nível da árvore),
 * assim "Calças" existe uma vez e é filtrada por gender=masculino/feminino.
 * Os slugs das folhas correspondem aos do normalizador (normalizer/dictionaries.ts).
 */
const CATEGORY_TREE = [
  {
    name: 'Roupas',
    slug: 'roupas',
    children: [
      { name: 'Camisas', slug: 'camisas' },
      { name: 'Camisetas', slug: 'camisetas' },
      { name: 'Blusas', slug: 'blusas' },
      { name: 'Vestidos', slug: 'vestidos' },
      { name: 'Saias', slug: 'saias' },
      { name: 'Calças', slug: 'calcas' },
      { name: 'Bermudas', slug: 'bermudas' },
      { name: 'Shorts', slug: 'shorts' },
      { name: 'Macacões', slug: 'macacoes' },
      { name: 'Casacos e Jaquetas', slug: 'casacos' },
      { name: 'Moda Praia', slug: 'moda-praia' },
      { name: 'Moda Íntima e Pijamas', slug: 'moda-intima' },
    ],
  },
  { name: 'Calçados', slug: 'calcados', children: [] },
  { name: 'Acessórios', slug: 'acessorios', children: [] },
];

const SOURCES = [
  {
    name: 'Renner',
    slug: 'renner',
    baseUrl: 'https://www.lojasrenner.com.br',
    enabled: true,
    crawlInterval: 360,
    maxPages: 50,
  },
  {
    name: 'C&A',
    slug: 'ca',
    baseUrl: 'https://www.cea.com.br',
    enabled: true,
    crawlInterval: 360,
    // Total de peças por sincronização, dividido igualmente entre as subcategorias (250 cada).
    // Subcategoria em vez de "moda-feminina/roupas": a API VTEX para em 2.500 itens por caminho,
    // e o caminho geral trazia quase só blusas (as primeiras da lista).
    maxPages: 3500,
    config: {
      categories: [
        'moda-feminina/roupas/blusas',
        'moda-feminina/roupas/calcas',
        'moda-feminina/roupas/casacos',
        'moda-feminina/roupas/macacoes',
        'moda-feminina/roupas/saias',
        'moda-feminina/roupas/shorts',
        'moda-feminina/roupas/vestidos',
        'moda-masculina/roupas/blusas',
        'moda-masculina/roupas/camisas',
        'moda-masculina/roupas/camisetas',
        'moda-masculina/roupas/casacos',
        'moda-masculina/roupas/bermudas',
        'moda-masculina/roupas/calcas',
        'moda-masculina/roupas/macacoes',
      ],
    },
  },
  {
    // Desabilitada: requer integração autorizada (API oficial/afiliados). Ver README.
    name: 'Amazon',
    slug: 'amazon',
    baseUrl: 'https://www.amazon.com.br',
    enabled: false,
    crawlInterval: null,
    maxPages: 50,
  },
];

async function seedCategories() {
  for (const root of CATEGORY_TREE) {
    const parent = await prisma.category.upsert({
      where: { slug: root.slug },
      create: { name: root.name, slug: root.slug },
      update: { name: root.name, parentId: null },
    });
    for (const child of root.children) {
      await prisma.category.upsert({
        where: { slug: child.slug },
        create: { name: child.name, slug: child.slug, parentId: parent.id },
        update: { name: child.name, parentId: parent.id },
      });
    }
  }
}

async function seedSources() {
  for (const source of SOURCES) {
    // Só cria: não sobrescreve ajustes feitos depois via PATCH /sources/:id.
    await prisma.source.upsert({ where: { slug: source.slug }, create: source, update: {} });
  }
}

async function main() {
  await seedCategories();
  await seedSources();
  const [categories, sources] = await Promise.all([prisma.category.count(), prisma.source.count()]);
  console.log(`Seed completed: ${categories} categories, ${sources} sources`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
