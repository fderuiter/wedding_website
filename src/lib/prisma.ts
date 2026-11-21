import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '@/env';

interface GlobalPrismaState {
  prisma?: PrismaClient;
  pgPool?: Pool;
  prismaShutdownRegistered?: boolean;
  prismaShutdownPromise?: Promise<void> | null;
}

/**
 * Global object extended with the Prisma client and PostgreSQL pool to prevent
 * multiple instances in development (hot-reloading) and duplicate signal hooks.
 */
const globalForPrisma = globalThis as unknown as GlobalPrismaState;

const createPrismaRuntime = (): { prisma: PrismaClient; pool: Pool } => {
  console.log('DEBUG [createPrismaClient]: Initializing PostgreSQL database client');
  const connectionString = env.DATABASE_URL;
  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 3000,
  });
  const adapter = new PrismaPg(pool);
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
 * Singleton instance of the PrismaClient.
 * In development, it reuses the existing instance if available.
 * In production, it creates a new instance.
 * @type {PrismaClient}
 */
export const prisma: PrismaClient = runtime.prisma;
const pool: Pool = runtime.pool;

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
  globalForPrisma.pgPool = pool;
}

/**
 * Gracefully disconnects Prisma and drains the underlying pg.Pool so active
 * sockets transmit PostgreSQL Terminate (0x58) frames before closing.
 */
async function shutdownPrisma(): Promise<void> {
  if (globalForPrisma.prismaShutdownPromise) {
    return globalForPrisma.prismaShutdownPromise;
  }

  const runShutdown = (async () => {
    try {
      await prisma.$disconnect();
    } catch (error) {
      console.error('Error disconnecting Prisma client during shutdown:', error);
    }

    try {
      const poolState = pool as Pool & { ending?: boolean; ended?: boolean };
      if (typeof pool.end === 'function' && !poolState.ending && !poolState.ended) {
        await pool.end();
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

    process.exit = ((code?: number) => {
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
      // Next.js standalone server closes HTTP listeners first and then invokes process.exit().
      // Start a fallback timer in case the other listener never calls process.exit().
      const fallbackTimer = setTimeout(() => {
        void shutdownPrisma().finally(() => {
          originalExit(signal === 'SIGINT' ? 130 : 143);
        });
      }, 4500);
      fallbackTimer.unref?.();
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
