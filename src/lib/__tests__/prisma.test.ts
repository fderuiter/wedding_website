/**
 * @jest-environment node
 */

import type { PrismaClient } from '@prisma/client';

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
  const globalForPrisma = global as unknown as { prisma?: PrismaClient };

  beforeEach(() => {
    delete globalForPrisma.prisma;
  });

  afterEach(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
    delete globalForPrisma.prisma;
  });

  test('reuses the prisma client in development', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'development';

    const prisma1 = await loadPrisma();
    const prisma2 = await loadPrisma();

    expect(prisma1).toBe(prisma2);

    await prisma1.$disconnect();
  });

  test('creates a new prisma client per import in production', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';

    const prisma1 = await loadPrisma();
    const prisma2 = await loadPrisma();

    expect(prisma1).not.toBe(prisma2);

    await prisma1.$disconnect();
    await prisma2.$disconnect();
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

  test('configures Pool defaults (max=5, connectionTimeoutMillis=10000) and passes { schema } to PrismaPg while honoring URI overrides', async () => {
    const originalDbUrl = process.env.DATABASE_URL;
    const poolCalls: unknown[] = [];
    const adapterCalls: unknown[] = [];

    try {
      await jest.isolateModulesAsync(async () => {
        process.env.DATABASE_URL = 'postgresql://wedding:wedding123@localhost:5432/wedding_test';
        jest.doMock('pg', () => ({
          Pool: jest.fn().mockImplementation((cfg: unknown) => {
            poolCalls.push(cfg);
            return { end: jest.fn().mockResolvedValue(undefined) };
          }),
        }));
        jest.doMock('@prisma/adapter-pg', () => ({
          PrismaPg: jest.fn().mockImplementation((_pool: unknown, opts: unknown) => {
            adapterCalls.push(opts);
            return {};
          }),
        }));
        jest.doMock('@prisma/client', () => ({
          PrismaClient: jest.fn().mockImplementation(() => ({
            $disconnect: jest.fn().mockResolvedValue(undefined),
          })),
        }));

        await import('../prisma');
      });

      expect(poolCalls[0]).toMatchObject({
        host: 'localhost',
        port: 5432,
        database: 'wedding_test',
        max: 5,
        connectionTimeoutMillis: 10000,
        ssl: false,
      });
      expect(adapterCalls[0]).toEqual({ schema: 'public' });

      delete (global as unknown as { pgPool?: unknown }).pgPool;
      delete globalForPrisma.prisma;

      await jest.isolateModulesAsync(async () => {
        process.env.DATABASE_URL =
          'postgresql://wedding:wedding123@/wedding_db?host=/cloudsql/proj:us-central1:db&schema=tenant_ceremony&connection_limit=3&connect_timeout=14&socket_timeout=9';
        jest.doMock('pg', () => ({
          Pool: jest.fn().mockImplementation((cfg: unknown) => {
            poolCalls.push(cfg);
            return { end: jest.fn().mockResolvedValue(undefined) };
          }),
        }));
        jest.doMock('@prisma/adapter-pg', () => ({
          PrismaPg: jest.fn().mockImplementation((_pool: unknown, opts: unknown) => {
            adapterCalls.push(opts);
            return {};
          }),
        }));
        jest.doMock('@prisma/client', () => ({
          PrismaClient: jest.fn().mockImplementation(() => ({
            $disconnect: jest.fn().mockResolvedValue(undefined),
          })),
        }));

        await import('../prisma');
      });

      expect(poolCalls[1]).toMatchObject({
        host: '/cloudsql/proj:us-central1:db',
        database: 'wedding_db',
        max: 3,
        connectionTimeoutMillis: 14000,
        query_timeout: 9000,
      });
      expect(adapterCalls[1]).toEqual({ schema: 'tenant_ceremony' });
    } finally {
      if (originalDbUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = originalDbUrl;
      }
      delete (global as unknown as { pgPool?: unknown }).pgPool;
      jest.dontMock('pg');
      jest.dontMock('@prisma/adapter-pg');
      jest.dontMock('@prisma/client');
    }
  });
});
