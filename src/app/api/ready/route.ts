import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const REQUIRED_SCHEMA_TABLES = [
  'AppConfig',
  'Media',
  'RegistryItem',
  'Contributor',
  'InvitationCode',
  'ContentNode',
  'SubEvent',
] as const;

interface TableRow {
  table_name: string;
}

interface MigrationRow {
  migration_name: string;
  finished_at: Date | string | null;
  rolled_back_at: Date | string | null;
}

function buildSchemaUnavailableResponse(detailMessage: string) {
  const errorMessage =
    process.env.NODE_ENV === 'production' ? 'Database schema is not ready' : detailMessage;
  return NextResponse.json(
    {
      status: 'unhealthy',
      database: 'connected',
      error: errorMessage,
      timestamp: new Date().toISOString(),
    },
    {
      status: 503,
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}

/**
 * @description Readiness probe endpoint. Verifies PostgreSQL connectivity, core schema tables, and applied Prisma migrations (when _prisma_migrations exists) without requiring seeded AppConfig rows. Returns 200 OK if ready, or 503 if unhealthy.
 */
export async function GET() {
  try {
    const tableRows = await prisma.$queryRaw<TableRow[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_type = 'BASE TABLE'
    `;

    const presentTables = new Set(
      (Array.isArray(tableRows) ? tableRows : []).map((row) => row.table_name)
    );
    const missingTables = REQUIRED_SCHEMA_TABLES.filter((table) => !presentTables.has(table));

    if (missingTables.length > 0) {
      console.error('Readiness check failed: missing core schema tables:', missingTables);
      return buildSchemaUnavailableResponse(
        `Missing required database tables: ${missingTables.join(', ')}`
      );
    }

    if (presentTables.has('_prisma_migrations')) {
      const migrationRows = await prisma.$queryRaw<MigrationRow[]>`
        SELECT migration_name, finished_at, rolled_back_at
        FROM "_prisma_migrations"
      `;

      const normalizedMigrations = Array.isArray(migrationRows) ? migrationRows : [];
      const failedMigrations = normalizedMigrations.filter(
        (row) => row.finished_at === null && row.rolled_back_at === null
      );

      if (failedMigrations.length > 0) {
        const failedNames = failedMigrations.map((row) => row.migration_name);
        console.error('Readiness check failed: incomplete or failed migrations:', failedNames);
        return buildSchemaUnavailableResponse(
          `Failed or incomplete database migrations: ${failedNames.join(', ')}`
        );
      }

      const appliedCount = normalizedMigrations.filter(
        (row) => row.finished_at !== null && row.rolled_back_at === null
      ).length;

      if (appliedCount === 0) {
        console.error('Readiness check failed: zero applied migrations in _prisma_migrations');
        return buildSchemaUnavailableResponse(
          'No applied database migrations found in _prisma_migrations'
        );
      }
    }

    return NextResponse.json(
      {
        status: 'ready',
        database: 'connected',
        timestamp: new Date().toISOString(),
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error: unknown) {
    console.error('Readiness check failed:', error);
    const rawMessage = error instanceof Error ? error.message : '';
    const errorMessage =
      process.env.NODE_ENV === 'production'
        ? 'Database connection failed'
        : rawMessage || 'Database connection failed';
    return NextResponse.json(
      {
        status: 'unhealthy',
        database: 'disconnected',
        error: errorMessage,
        timestamp: new Date().toISOString(),
      },
      {
        status: 503,
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  }
}
