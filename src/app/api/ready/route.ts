import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * @description Readiness probe endpoint. Checks database connectivity and returns 200 OK if ready, or 503 if unhealthy.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json(
      {
        status: 'ready',
        database: 'connected',
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('Readiness check failed:', error);
    const errorMessage =
      process.env.NODE_ENV === 'production'
        ? 'Database connection failed'
        : error?.message || 'Database connection failed';
    return NextResponse.json(
      {
        status: 'unhealthy',
        database: 'disconnected',
        error: errorMessage,
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
