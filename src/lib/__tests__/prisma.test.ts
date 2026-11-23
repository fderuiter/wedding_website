/**
 * @jest-environment node
 */

import type { PrismaClient } from '@prisma/client';
import type { Pool } from 'pg';

interface GlobalPrismaTestState {
  prisma?: PrismaClient;
  pgPool?: Pool;
  prismaShutdownRegistered?: boolean;
  prismaShutdownPromise?: Promise<void> | null;
}

const loadPrisma = async (): Promise<PrismaClient> => {
  let prisma!: PrismaClient;
  await jest.isolateModulesAsync(async () => {
    const mod = await import('../prisma');
    prisma = mod.prisma;
  });
  return prisma;
};

describe('prisma singleton behavior', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalExit = process.exit;
  const globalForPrisma = globalThis as unknown as GlobalPrismaTestState;

  const resetGlobalPrismaState = async () => {
    if (globalForPrisma.prisma && typeof globalForPrisma.prisma.$disconnect === 'function') {
      try {
        await globalForPrisma.prisma.$disconnect();
      } catch {
        // Ignore teardown errors on mocked or uninitialized clients
      }
    }
    if (globalForPrisma.pgPool && typeof globalForPrisma.pgPool.end === 'function') {
      const poolState = globalForPrisma.pgPool as Pool & { ending?: boolean; ended?: boolean };
      if (!poolState.ending && !poolState.ended) {
        try {
          await globalForPrisma.pgPool.end();
        } catch {
          // Ignore teardown errors on mocked or uninitialized pools
        }
      }
    }
    delete globalForPrisma.prisma;
    delete globalForPrisma.pgPool;
    delete globalForPrisma.prismaShutdownRegistered;
    delete globalForPrisma.prismaShutdownPromise;
  };

  beforeEach(async () => {
    jest.spyOn(process, 'once').mockReturnValue(process);
    await resetGlobalPrismaState();
  });

  afterEach(async () => {
    process.exit = originalExit;
    (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
    await resetGlobalPrismaState();
    jest.restoreAllMocks();
  });

  test('reuses the prisma client and pgPool in development', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'development';

    const prisma1 = await loadPrisma();
    const pool1 = globalForPrisma.pgPool;
    const prisma2 = await loadPrisma();
    const pool2 = globalForPrisma.pgPool;

    expect(prisma1).toBe(prisma2);
    expect(globalForPrisma.prisma).toBe(prisma1);
    expect(pool1).toBeDefined();
    expect(pool1).toBe(pool2);
  });

  test('reuses the prisma client and pgPool across isolated imports in production', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';

    const prisma1 = await loadPrisma();
    const pool1 = globalForPrisma.pgPool;
    const prisma2 = await loadPrisma();
    const pool2 = globalForPrisma.pgPool;

    expect(prisma1).toBe(prisma2);
    expect(globalForPrisma.prisma).toBe(prisma1);
    expect(pool1).toBeDefined();
    expect(pool1).toBe(pool2);
  });

  test('reuses the prisma client and pgPool in test mode', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'test';

    const prisma1 = await loadPrisma();
    const pool1 = globalForPrisma.pgPool;
    const prisma2 = await loadPrisma();
    const pool2 = globalForPrisma.pgPool;

    expect(prisma1).toBe(prisma2);
    expect(globalForPrisma.prisma).toBe(prisma1);
    expect(pool1).toBeDefined();
    expect(pool1).toBe(pool2);
  });

  test('redacts raw connection strings from console output during initialization', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await loadPrisma();

    expect(consoleSpy).toHaveBeenCalled();
    const logCalls = consoleSpy.mock.calls;
    for (const call of logCalls) {
      const callString = JSON.stringify(call);
      expect(callString).not.toContain('connectionString');
      expect(callString).not.toContain('secretpassword');
      expect(callString).not.toContain('wedding123');
    }

    consoleSpy.mockRestore();
  });
});
