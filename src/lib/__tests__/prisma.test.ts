/**
 * @jest-environment node
 */

import type { PrismaClient } from '@prisma/client';

const loadPrisma = async (): Promise<PrismaClient> => {
  let prisma: PrismaClient;
  await jest.isolateModulesAsync(async () => {
    const mod = await import('../prisma');
    prisma = mod.prisma;
  });
  return prisma;
};

describe('prisma singleton behavior', () => {
  const originalEnv = process.env.NODE_ENV;
  const globalForPrisma = global as unknown as { prisma?: PrismaClient };

  beforeEach(() => {
    delete globalForPrisma.prisma;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    delete globalForPrisma.prisma;
  });

  test('reuses the prisma client in development', async () => {
    process.env.NODE_ENV = 'development';

    const prisma1 = await loadPrisma();
    const prisma2 = await loadPrisma();

    expect(prisma1).toBe(prisma2);

    await prisma1.$disconnect();
  });

  test('creates a new prisma client per import in production', async () => {
    process.env.NODE_ENV = 'production';

    const prisma1 = await loadPrisma();
    const prisma2 = await loadPrisma();

    expect(prisma1).not.toBe(prisma2);

    await prisma1.$disconnect();
    await prisma2.$disconnect();
  });
});
