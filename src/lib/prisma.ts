import { PrismaClient } from '@prisma/client';

/**
 * Global object extended with the prisma client type to prevent multiple instances
 * in development (hot-reloading).
 */
const globalForPrisma = global as unknown as { prisma: PrismaClient };

/**
 * Singleton instance of the PrismaClient.
 * In development, it reuses the existing instance if available.
 * In production, it creates a new instance.
 * @type {PrismaClient}
 */
export const prisma = globalForPrisma.prisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
