import { Prisma, type PrismaClient } from '@prisma/client';
import type { NormalizedProduct } from '../crawlers/normalizer/product.normalizer.js';
import { toOffset } from '../../shared/utils/pagination.js';
import type {
  ProductDetail,
  ProductFilters,
  ProductListItem,
  ProductListQuery,
  ProductSort,
  UpsertResult,
} from './product.types.js';

const summarySelect = { id: true, name: true, slug: true } as const;

/** Campos da listagem: nunca carrega rawData, description ou imagens. */
const listSelect = {
  id: true,
  externalId: true,
  name: true,
  slug: true,
  brand: true,
  gender: true,
  color: true,
  size: true,
  price: true,
  originalPrice: true,
  currency: true,
  imageUrl: true,
  productUrl: true,
  available: true,
  lastScrapedAt: true,
  category: { select: summarySelect },
  source: { select: summarySelect },
} satisfies Prisma.ProductSelect;

const detailSelect = {
  ...listSelect,
  description: true,
  imageCachedUrl: true,
  createdAt: true,
  updatedAt: true,
  images: {
    select: { url: true, cachedUrl: true, position: true },
    orderBy: { position: 'asc' },
  },
} satisfies Prisma.ProductSelect;

type ListRow = Prisma.ProductGetPayload<{ select: typeof listSelect }>;
type DetailRow = Prisma.ProductGetPayload<{ select: typeof detailSelect }>;

/** Ordenações permitidas (whitelist). Nunca interpolar nomes de coluna vindos do usuário. */
const ORDER_BY: Record<Exclude<ProductSort, 'relevance'>, Prisma.Sql> = {
  price_asc: Prisma.sql`p."price" ASC, p."id" ASC`,
  price_desc: Prisma.sql`p."price" DESC, p."id" ASC`,
  newest: Prisma.sql`p."createdAt" DESC, p."id" ASC`,
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class ProductRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Busca paginada. A seleção de ids usa SQL parametrizado (para permitir ordenar por
   * similaridade trigram); os dados são carregados em seguida com `select` tipado.
   */
  async findMany(query: ProductListQuery): Promise<{ items: ProductListItem[]; total: number }> {
    const { skip, take } = toOffset(query);
    const where = this.buildWhere(query.filters);
    const orderBy = this.buildOrderBy(query.sort, query.filters.query);

    const [idRows, countRows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT p."id" FROM "Product" p
        JOIN "Source" s ON s."id" = p."sourceId"
        ${where}
        ORDER BY ${orderBy}
        LIMIT ${take} OFFSET ${skip}`,
      this.prisma.$queryRaw<Array<{ total: number }>>`
        SELECT COUNT(*)::int AS "total" FROM "Product" p
        JOIN "Source" s ON s."id" = p."sourceId"
        ${where}`,
    ]);

    const ids = idRows.map((row) => row.id);
    const rows = ids.length
      ? await this.prisma.product.findMany({ where: { id: { in: ids } }, select: listSelect })
      : [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const items = ids.flatMap((id) => {
      const row = byId.get(id);
      return row ? [toListItem(row)] : [];
    });

    return { items, total: countRows[0]?.total ?? 0 };
  }

  async findById(id: string): Promise<ProductDetail | null> {
    const row = await this.prisma.product.findUnique({ where: { id }, select: detailSelect });
    return row ? toDetail(row) : null;
  }

  findByExternalId(sourceId: string, externalId: string) {
    return this.prisma.product.findUnique({
      where: { sourceId_externalId: { sourceId, externalId } },
      select: { id: true },
    });
  }

  /**
   * Cria ou atualiza pelo par (sourceId, externalId) — a identidade do produto.
   * Produto e imagens são gravados na mesma transação.
   */
  async upsert(
    sourceId: string,
    product: NormalizedProduct,
    categoryId: string | null,
    scrapedAt: Date,
  ): Promise<UpsertResult> {
    const key = { sourceId_externalId: { sourceId, externalId: product.externalId } };
    const data = {
      name: product.name,
      slug: product.slug,
      description: product.description,
      brand: product.brand,
      categoryId,
      gender: product.gender,
      color: product.color,
      size: product.size,
      price: product.price,
      originalPrice: product.originalPrice,
      currency: product.currency,
      imageUrl: product.imageUrl,
      productUrl: product.productUrl,
      available: product.available,
      searchText: product.searchText,
      rawData: (product.rawData ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      lastScrapedAt: scrapedAt,
    };

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.product.findUnique({ where: key, select: { id: true } });
      const saved = await tx.product.upsert({
        where: key,
        create: { sourceId, externalId: product.externalId, ...data },
        update: data,
        select: { id: true },
      });
      await this.replaceImages(tx, saved.id, product.images);
      return { id: saved.id, created: existing === null };
    });
  }

  private async replaceImages(
    tx: Prisma.TransactionClient,
    productId: string,
    images: string[],
  ): Promise<void> {
    await tx.productImage.deleteMany({ where: { productId, position: { gte: images.length } } });
    for (const [position, url] of images.entries()) {
      await tx.productImage.upsert({
        where: { productId_position: { productId, position } },
        create: { productId, position, url },
        update: { url },
      });
    }
  }

  private buildWhere(filters: ProductFilters): Prisma.Sql {
    const conditions: Prisma.Sql[] = [];

    // Cada termo precisa casar no início de uma palavra (\m): "calca" casa "calcas",
    // mas "short" não casa dentro de outra palavra. Termos contêm apenas [a-z0-9].
    for (const term of filters.terms) {
      conditions.push(Prisma.sql`p."searchText" ~ ${`\\m${escapeRegex(term)}`}`);
    }
    if (filters.categoryIds) {
      conditions.push(
        filters.categoryIds.length
          ? Prisma.sql`p."categoryId" IN (${Prisma.join(
              filters.categoryIds.map((id) => Prisma.sql`${id}::uuid`),
            )})`
          : Prisma.sql`FALSE`,
      );
    }
    if (filters.gender) {
      // Busca "masculino" aceitando unissex e sem gênero: bolsas, óculos e tênis quase nunca dizem
      // o gênero no nome (~30% da Renner) e sumiam da busca do provador.
      const neutral =
        filters.includeNeutralGender &&
        (filters.gender === 'masculino' || filters.gender === 'feminino');
      conditions.push(
        neutral
          ? Prisma.sql`(p."gender" = ${filters.gender} OR p."gender" = 'unissex' OR p."gender" IS NULL)`
          : Prisma.sql`p."gender" = ${filters.gender}`,
      );
    }
    if (filters.excludeGender) {
      conditions.push(Prisma.sql`(p."gender" IS NULL OR p."gender" <> ${filters.excludeGender})`);
    }
    if (filters.color) conditions.push(Prisma.sql`p."color" = ${filters.color}`);
    if (filters.brand) conditions.push(Prisma.sql`LOWER(p."brand") = LOWER(${filters.brand})`);
    if (filters.source) conditions.push(Prisma.sql`s."slug" = ${filters.source}`);
    if (filters.minPrice !== undefined)
      conditions.push(Prisma.sql`p."price" >= ${filters.minPrice}`);
    if (filters.maxPrice !== undefined)
      conditions.push(Prisma.sql`p."price" <= ${filters.maxPrice}`);
    if (filters.available !== undefined) {
      conditions.push(Prisma.sql`p."available" = ${filters.available}`);
    }

    return conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
  }

  private buildOrderBy(sort: ProductSort, query: string | undefined): Prisma.Sql {
    if (sort !== 'relevance') return ORDER_BY[sort];
    if (!query) return Prisma.sql`p."available" DESC, p."updatedAt" DESC, p."id" ASC`;
    return Prisma.sql`similarity(p."searchText", ${query}) DESC, p."available" DESC, p."updatedAt" DESC, p."id" ASC`;
  }
}

function toNumber(value: Prisma.Decimal): number;
function toNumber(value: Prisma.Decimal | null): number | null;
function toNumber(value: Prisma.Decimal | null): number | null {
  return value === null ? null : value.toNumber();
}

function toListItem(row: ListRow): ProductListItem {
  return {
    id: row.id,
    externalId: row.externalId,
    name: row.name,
    slug: row.slug,
    brand: row.brand,
    category: row.category,
    gender: row.gender,
    color: row.color,
    size: row.size,
    price: toNumber(row.price),
    originalPrice: toNumber(row.originalPrice),
    currency: row.currency,
    imageUrl: row.imageUrl,
    productUrl: row.productUrl,
    available: row.available,
    source: row.source,
    lastScrapedAt: row.lastScrapedAt.toISOString(),
  };
}

function toDetail(row: DetailRow): ProductDetail {
  return {
    ...toListItem(row),
    description: row.description,
    imageCachedUrl: row.imageCachedUrl,
    images: row.images,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
