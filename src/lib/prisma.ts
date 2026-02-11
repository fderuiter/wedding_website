import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Global object extended with the prisma client type to prevent multiple instances
 * in development (hot-reloading).
 */
const globalForPrisma = global as unknown as { prisma: PrismaClient };

const createPrismaClient = () => {
  const connectionString = process.env.POSTGRES_PRISMA_URL;
  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
};

/**
 * Singleton instance of the PrismaClient.
 * In development, it reuses the existing instance if available.
 * In production, it creates a new instance.
 * @type {PrismaClient}
 */
export const prisma = globalForPrisma.prisma || createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
