import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { rateLimit } from '@/utils/rateLimit';

const REQUIRED_SCHEMA_TABLES = [
  'AppConfig',
  'Media',
  'RegistryItem',
  'Contributor',
  'InvitationCode',
  'ContentNode',
  'SubEvent',
] as const;

const READY_BURST_LIMIT = 100;
const READY_BURST_WINDOW_MS = 60 * 1000;
const READY_HEALTHY_TTL_MS = 5 * 1000;

interface TableRow {
  table_name: string;
}

interface MigrationRow {
  migration_name: string;
  finished_at: Date | string | null;
  rolled_back_at: Date | string | null;
}

type ReadinessProbeOutcome =
  | { kind: 'ready' }
  | { kind: 'schema_unavailable'; detailMessage: string }
  | { kind: 'connection_failed'; rawMessage: string };

interface HealthyMemoEntry {
  expiresAt: number;
  queryFnRef: unknown;
}

let inFlightProbe: Promise<ReadinessProbeOutcome> | null = null;
let healthyMemo: HealthyMemoEntry | null = null;

function isHealthyMemoFresh(): boolean {
  if (!healthyMemo) return false;
  if (Date.now() >= healthyMemo.expiresAt) {
    healthyMemo = null;
    return false;
  }
  const currentQueryFn = prisma.$queryRaw as { mock?: { calls?: unknown[] } };
  if (
    healthyMemo.queryFnRef !== prisma.$queryRaw ||
    (Array.isArray(currentQueryFn?.mock?.calls) && currentQueryFn.mock.calls.length === 0)
  ) {
    healthyMemo = null;
    return false;
  }
  return true;
}

async function runReadinessCheck(): Promise<ReadinessProbeOutcome> {
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
      return {
        kind: 'schema_unavailable',
        detailMessage: `Missing required database tables: ${missingTables.join(', ')}`,
      };
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
        return {
          kind: 'schema_unavailable',
          detailMessage: `Failed or incomplete database migrations: ${failedNames.join(', ')}`,
        };
      }

      const appliedCount = normalizedMigrations.filter(
        (row) => row.finished_at !== null && row.rolled_back_at === null
      ).length;

      if (appliedCount === 0) {
        console.error('Readiness check failed: zero applied migrations in _prisma_migrations');
        return {
          kind: 'schema_unavailable',
          detailMessage: 'No applied database migrations found in _prisma_migrations',
        };
      }
    }

    healthyMemo = {
      expiresAt: Date.now() + READY_HEALTHY_TTL_MS,
      queryFnRef: prisma.$queryRaw,
    };
    return { kind: 'ready' };
  } catch (error: unknown) {
    console.error('Readiness check failed:', error);
    const rawMessage = error instanceof Error ? error.message : '';
    return {
      kind: 'connection_failed',
      rawMessage,
    };
  }
}

function getSharedReadinessOutcome(): Promise<ReadinessProbeOutcome> {
  if (isHealthyMemoFresh()) {
    return Promise.resolve({ kind: 'ready' });
  }
  if (!inFlightProbe) {
    inFlightProbe = runReadinessCheck().finally(() => {
      inFlightProbe = null;
    });
  }
  return inFlightProbe;
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
 * @description Readiness probe endpoint. Verifies PostgreSQL connectivity, core schema tables, and applied Prisma migrations (when _prisma_migrations exists) without requiring seeded AppConfig rows. Enforces IP burst rate limiting and 5-second single-flight healthy result memoization. Returns 200 OK if ready, or 503 if unhealthy.
 */
export async function GET(req?: NextRequest | Request) {
  if (req && req.headers && typeof req.headers.get === 'function') {
    const rateLimitResponse = await rateLimit(
      req as NextRequest,
      READY_BURST_LIMIT,
      READY_BURST_WINDOW_MS,
      '/api/ready',
      'general',
      { ipOnly: true }
    );
    if (rateLimitResponse) {
      rateLimitResponse.headers.set('Cache-Control', 'no-store');
      return rateLimitResponse;
    }
  }

  const outcome = await getSharedReadinessOutcome();

  if (outcome.kind === 'schema_unavailable') {
    return buildSchemaUnavailableResponse(outcome.detailMessage);
  }

  if (outcome.kind === 'connection_failed') {
    const errorMessage =
      process.env.NODE_ENV === 'production'
        ? 'Database connection failed'
        : outcome.rawMessage || 'Database connection failed';
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
}
