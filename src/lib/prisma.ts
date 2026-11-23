import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '@/env';
import { buildPostgresRuntimeConfig } from '@/lib/postgresPool';

interface GlobalPrismaState {
  prisma?: PrismaClient;
  pgPool?: Pool;
  prismaShutdownRegistered?: boolean;
  prismaShutdownPromise?: Promise<void> | null;
}

/**
 * Global object extended with the Prisma client and PostgreSQL pool so every
 * module graph in a single Node.js process shares one pool and signal hook.
 */
const globalForPrisma = globalThis as unknown as GlobalPrismaState;

const createPrismaRuntime = (): { prisma: PrismaClient; pool: Pool } => {
  console.log('DEBUG [createPrismaClient]: Initializing PostgreSQL database client');
  const { poolConfig, adapterOptions } = buildPostgresRuntimeConfig(env.DATABASE_URL);
  const pool = new Pool(poolConfig);
  const adapter = new PrismaPg(pool, adapterOptions);
  const client = new PrismaClient({ adapter });
  return { prisma: client, pool };
};

const existingPrisma = globalForPrisma.prisma;
const existingPool = globalForPrisma.pgPool;
const runtime =
  existingPrisma && existingPool
    ? { prisma: existingPrisma, pool: existingPool }
    : createPrismaRuntime();

/**
 * Singleton instance of the PrismaClient shared across all module graphs
 * (SSR, API route handlers, hot-reload, and tests) in the current process.
 * @type {PrismaClient}
 */
export const prisma: PrismaClient = runtime.prisma;
const pool: Pool = runtime.pool;

globalForPrisma.prisma = prisma;
globalForPrisma.pgPool = pool;

/**
 * Returns the singleton PostgreSQL connection pool backing PrismaClient so
 * low-volume runtime helpers (such as cross-instance auth lockouts) can execute
 * parameterized queries without allocating extra pools or vendor caches.
 */
export function getPgPool(): Pool | undefined {
  return globalForPrisma.pgPool ?? pool;
}

/**
 * Gracefully disconnects Prisma and drains the underlying pg.Pool so active
 * sockets transmit PostgreSQL Terminate (0x58) frames before closing.
 */
async function shutdownPrisma(): Promise<void> {
  if (globalForPrisma.prismaShutdownPromise) {
    return globalForPrisma.prismaShutdownPromise;
  }

  const activePrisma = globalForPrisma.prisma ?? prisma;
  const activePool = globalForPrisma.pgPool ?? pool;

  const runShutdown = (async () => {
    try {
      await activePrisma.$disconnect();
    } catch (error) {
      console.error('Error disconnecting Prisma client during shutdown:', error);
    }

    try {
      const poolState = activePool as Pool & { ending?: boolean; ended?: boolean };
      if (typeof activePool.end === 'function' && !poolState.ending && !poolState.ended) {
        await activePool.end();
      }
    } catch (error) {
      console.error('Error draining PostgreSQL connection pool during shutdown:', error);
    }
  })();

  globalForPrisma.prismaShutdownPromise = runShutdown;
  return runShutdown;
}

function registerPrismaShutdownHooks(): void {
  if (globalForPrisma.prismaShutdownRegistered || typeof process === 'undefined' || typeof process.once !== 'function') {
    return;
  }
  globalForPrisma.prismaShutdownRegistered = true;

  const originalExit = process.exit.bind(process);
  let exitIntercepted = false;

  const interceptProcessExitUntilDrained = () => {
    if (exitIntercepted || env.NODE_ENV === 'test') {
      return;
    }
    exitIntercepted = true;

    let exitDrainStarted = false;
    process.exit = ((code?: number) => {
      if (exitDrainStarted) {
        return undefined as never;
      }
      exitDrainStarted = true;

      const safetyTimer = setTimeout(() => {
        originalExit(code);
      }, 5000);
      safetyTimer.unref?.();

      void shutdownPrisma().finally(() => {
        clearTimeout(safetyTimer);
        originalExit(code);
      });
      return undefined as never;
    }) as typeof process.exit;
  };

  const handleTerminationSignal = (signal: 'SIGTERM' | 'SIGINT') => {
    const hasFrameworkSignalListener = process.listenerCount(signal) > 0;

    if (env.NODE_ENV === 'test') {
      void shutdownPrisma();
      return;
    }

    interceptProcessExitUntilDrained();

    if (hasFrameworkSignalListener) {
      // Framework signal listener (e.g. Next.js standalone start-server.js) closes HTTP
      // listeners and finishes active requests before invoking process.exit(), which
      // interceptProcessExitUntilDrained() defers until shutdownPrisma() drains the pool.
      return;
    }

    const safetyTimer = setTimeout(() => {
      originalExit(signal === 'SIGINT' ? 130 : 143);
    }, 5000);
    safetyTimer.unref?.();

    void shutdownPrisma().finally(() => {
      clearTimeout(safetyTimer);
      originalExit(signal === 'SIGINT' ? 130 : 143);
    });
  };

  process.once('SIGTERM', () => handleTerminationSignal('SIGTERM'));
  process.once('SIGINT', () => handleTerminationSignal('SIGINT'));
}

registerPrismaShutdownHooks();
