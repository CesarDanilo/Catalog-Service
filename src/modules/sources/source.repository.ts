import { Prisma, type PrismaClient } from '@prisma/client';

const sourceSelect = {
  id: true,
  name: true,
  slug: true,
  baseUrl: true,
  enabled: true,
  crawlInterval: true,
  maxPages: true,
  config: true,
  lastSyncAt: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { products: true } },
} satisfies Prisma.SourceSelect;

export type SourceRecord = Prisma.SourceGetPayload<{ select: typeof sourceSelect }>;

export type SourceUpdateData = Partial<{
  name: string;
  baseUrl: string;
  enabled: boolean;
  crawlInterval: number | null;
  maxPages: number | null;
  config: Record<string, unknown> | null;
}>;

export class SourceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findAll(): Promise<SourceRecord[]> {
    return this.prisma.source.findMany({ select: sourceSelect, orderBy: { name: 'asc' } });
  }

  findById(id: string): Promise<SourceRecord | null> {
    return this.prisma.source.findUnique({ where: { id }, select: sourceSelect });
  }

  findScheduled(): Promise<SourceRecord[]> {
    return this.prisma.source.findMany({
      where: { enabled: true, crawlInterval: { not: null } },
      select: sourceSelect,
    });
  }

  update(id: string, data: SourceUpdateData): Promise<SourceRecord> {
    const { config, ...rest } = data;
    return this.prisma.source.update({
      where: { id },
      data: {
        ...rest,
        ...(config !== undefined && {
          config: config === null ? Prisma.DbNull : (config as Prisma.InputJsonValue),
        }),
      },
      select: sourceSelect,
    });
  }

  async markSynced(id: string, at: Date): Promise<void> {
    await this.prisma.source.update({ where: { id }, data: { lastSyncAt: at } });
  }
}
