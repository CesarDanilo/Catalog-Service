import { prisma } from '../../src/infrastructure/database/prisma.js';
import { redis } from '../../src/infrastructure/redis/redis.js';

function assertTestDatabase(): void {
  const url = process.env.DATABASE_URL ?? '';
  if (!new URL(url).pathname.includes('test')) {
    throw new Error(`Refusing to reset a non-test database: ${url}`);
  }
}

/** Limpa todas as tabelas do banco de teste e o db de teste do Redis. */
export async function resetDatabase(): Promise<void> {
  assertTestDatabase();
  await prisma.$executeRawUnsafe(
    'TRUNCATE "ProductImage", "Product", "CrawlJob", "Source", "Category" RESTART IDENTITY CASCADE',
  );
  if (redis.status === 'wait') await redis.connect();
  await redis.flushdb();
}

export async function seedBasics() {
  const roupas = await prisma.category.create({ data: { name: 'Roupas', slug: 'roupas' } });
  const [camisas, vestidos, calcas] = await Promise.all(
    [
      ['Camisas', 'camisas'],
      ['Vestidos', 'vestidos'],
      ['Calças', 'calcas'],
    ].map(([name, slug]) =>
      prisma.category.create({ data: { name: name!, slug: slug!, parentId: roupas.id } }),
    ),
  );
  const [renner, ca, amazon] = await Promise.all([
    prisma.source.create({
      data: { name: 'Renner', slug: 'renner', baseUrl: 'https://www.lojasrenner.com.br' },
    }),
    prisma.source.create({ data: { name: 'C&A', slug: 'ca', baseUrl: 'https://www.cea.com.br' } }),
    prisma.source.create({
      data: {
        name: 'Amazon',
        slug: 'amazon',
        baseUrl: 'https://www.amazon.com.br',
        enabled: false,
      },
    }),
  ]);
  return {
    categories: { roupas, camisas: camisas!, vestidos: vestidos!, calcas: calcas! },
    sources: { renner, ca, amazon },
  };
}

export async function closeConnections(): Promise<void> {
  await prisma.$disconnect();
  if (redis.status !== 'end' && redis.status !== 'wait') await redis.quit();
}

export { prisma, redis };
