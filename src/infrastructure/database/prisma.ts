import { PrismaClient } from '@prisma/client';
import { env } from '../../config/env.js';

export const prisma = new PrismaClient({
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}

export async function pingDatabase(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}
