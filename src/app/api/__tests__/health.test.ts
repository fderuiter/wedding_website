/** @jest-environment node */

jest.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn(),
  },
}));

import { NextRequest } from 'next/server';
import { GET as healthRoute } from '@/app/api/health/route';
import { GET as liveRoute } from '@/app/api/live/route';
import { GET as readyRoute } from '@/app/api/ready/route';
import { prisma } from '@/lib/prisma';
import {
  REQUIRED_MIGRATION_NAMES,
  REQUIRED_SCHEMA_TABLES,
} from '@/lib/readinessManifest';

const mockQueryRaw = prisma.$queryRaw as jest.Mock;

describe('Health and Readiness Endpoints', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.clearAllMocks();
    (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
  });

  afterAll(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
  });

  describe('GET /api/live (Process Liveness)', () => {
    it('returns 200 OK with status alive without querying PostgreSQL even when database is unreachable', async () => {
      mockQueryRaw.mockRejectedValue(new Error('Connection refused'));
      const res = await liveRoute();
      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      const json = await res.json();
      expect(json.status).toBe('alive');
      expect(typeof json.timestamp).toBe('string');
      expect(mockQueryRaw).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/health (Startup & Rollout Readiness)', () => {
    it('returns 200 OK with status ok and Cache-Control: no-store', async () => {
      mockQueryRaw.mockResolvedValue([{ '?column?': 1 }]);
      const res = await healthRoute();
      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      const json = await res.json();
      const status = json.data?.status || json.status;
      expect(status).toBe('ok');
    });

    it('returns 503 with status, database, and timestamp in development mode when database query fails', async () => {
      (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
      mockQueryRaw.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:5432'));
      const res = await healthRoute();
      expect(res.status).toBe(503);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.status).toBe('degraded');
      expect(json.database).toBe('disconnected');
      expect(typeof json.timestamp).toBe('string');
      expect(json.error).toBe('Database connection failed');
    });

    it('preserves status, database, and timestamp with sanitized error text in production mode without leaking driver strings', async () => {
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      mockQueryRaw.mockRejectedValue(
        new Error(
          'FATAL: password authentication failed for postgresql://wedding:supersecret@10.0.0.12:5432/wedding'
        )
      );
      const res = await healthRoute();
      expect(res.status).toBe(503);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.status).toBe('degraded');
      expect(json.database).toBe('disconnected');
      expect(typeof json.timestamp).toBe('string');
      expect(json.error).toBe('Database connection failed');
      expect(JSON.stringify(json)).not.toContain('postgresql://');
      expect(JSON.stringify(json)).not.toContain('supersecret');
      expect(json.referenceId).toBeUndefined();
    });
  });

  describe('GET /api/ready (Readiness)', () => {
    const coreTableRows = REQUIRED_SCHEMA_TABLES.map((table_name) => ({ table_name }));
    const appliedMigrationRows = REQUIRED_MIGRATION_NAMES.map((migration_name) => ({
      migration_name,
      finished_at: '2026-11-22T00:00:00.000Z',
      rolled_back_at: null,
    }));

    it('returns 200 OK on an unseeded migrated database when core tables and applied migrations exist', async () => {
      mockQueryRaw
        .mockResolvedValueOnce([...coreTableRows, { table_name: '_prisma_migrations' }])
        .mockResolvedValueOnce(appliedMigrationRows);

      const res = await readyRoute();
      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      const json = await res.json();
      expect(json.status).toBe('ready');
      expect(json.database).toBe('connected');
      expect(mockQueryRaw).toHaveBeenCalledTimes(2);
    });

    it('returns 200 OK when core tables exist via prisma db push without _prisma_migrations', async () => {
      mockQueryRaw.mockResolvedValueOnce(coreTableRows);

      const res = await readyRoute();
      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      const json = await res.json();
      expect(json.status).toBe('ready');
      expect(json.database).toBe('connected');
      expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    });

    it('scopes information_schema.tables and _prisma_migrations to custom ?schema= from DATABASE_URL', async () => {
      const originalDbUrl = process.env.DATABASE_URL;
      process.env.DATABASE_URL =
        'postgresql://wedding:wedding123@localhost:5432/wedding?schema=custom_tenant';
      try {
        mockQueryRaw
          .mockResolvedValueOnce([...coreTableRows, { table_name: '_prisma_migrations' }])
          .mockResolvedValueOnce(appliedMigrationRows);

        const res = await readyRoute();
        expect(res.status).toBe(200);
        expect(mockQueryRaw).toHaveBeenCalledTimes(2);

        const tablesSqlArg = mockQueryRaw.mock.calls[0]?.[0] as {
          sql?: string;
          values?: unknown[];
        };
        expect(tablesSqlArg.values).toEqual(['custom_tenant']);
        expect(tablesSqlArg.sql).not.toContain('current_schema()');

        const migrationsSqlArg = mockQueryRaw.mock.calls[1]?.[0] as { sql?: string };
        expect(migrationsSqlArg.sql).toContain('FROM "custom_tenant"."_prisma_migrations"');
      } finally {
        if (originalDbUrl === undefined) {
          delete process.env.DATABASE_URL;
        } else {
          process.env.DATABASE_URL = originalDbUrl;
        }
      }
    });

    it('returns 200 OK when a previously failed migration was rolled back and subsequent migrations succeeded', async () => {
      mockQueryRaw
        .mockResolvedValueOnce([...coreTableRows, { table_name: '_prisma_migrations' }])
        .mockResolvedValueOnce([
          ...appliedMigrationRows,
          {
            migration_name: '20261122000000_aborted_attempt',
            finished_at: null,
            rolled_back_at: '2026-11-22T01:00:00.000Z',
          },
        ]);

      const res = await readyRoute();
      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      const json = await res.json();
      expect(json.status).toBe('ready');
    });

    it('returns 200 OK during N-1 rollout or rollback when _prisma_migrations includes finished and unfinished forward migrations from an N+1 release', async () => {
      expect(REQUIRED_MIGRATION_NAMES).toHaveLength(47);
      const migrationsWithForwardRows = [
        ...appliedMigrationRows,
        {
          migration_name: '20261201000000_forward_n_plus_1_release_column',
          finished_at: '2026-12-01T00:00:00.000Z',
          rolled_back_at: null,
        },
        {
          migration_name: '20261202000000_forward_n_plus_1_index',
          finished_at: '2026-12-02T00:00:00.000Z',
          rolled_back_at: null,
        },
        {
          migration_name: '20261203000000_forward_n_plus_1_unfinished',
          finished_at: null,
          rolled_back_at: null,
        },
      ];

      (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
      mockQueryRaw
        .mockResolvedValueOnce([...coreTableRows, { table_name: '_prisma_migrations' }])
        .mockResolvedValueOnce(migrationsWithForwardRows);

      const devRes = await readyRoute();
      expect(devRes.status).toBe(200);
      expect(devRes.headers.get('Cache-Control')).toBe('no-store');
      const devJson = await devRes.json();
      expect(devJson.status).toBe('ready');
      expect(devJson.database).toBe('connected');
      expect(mockQueryRaw).toHaveBeenCalledTimes(2);

      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      mockQueryRaw.mockReset();
      mockQueryRaw
        .mockResolvedValueOnce([...coreTableRows, { table_name: '_prisma_migrations' }])
        .mockResolvedValueOnce(migrationsWithForwardRows);

      const prodRes = await readyRoute();
      expect(prodRes.status).toBe(200);
      expect(prodRes.headers.get('Cache-Control')).toBe('no-store');
      const prodJson = await prodRes.json();
      expect(prodJson.status).toBe('ready');
      expect(prodJson.database).toBe('connected');
      expect(mockQueryRaw).toHaveBeenCalledTimes(2);
    });

    it('returns 200 OK when a required migration has both a rolled-back row and a completed retry row, and 503 when it has only a rolled-back row', async () => {
      const retriedMigrationName = REQUIRED_MIGRATION_NAMES[0];

      mockQueryRaw
        .mockResolvedValueOnce([...coreTableRows, { table_name: '_prisma_migrations' }])
        .mockResolvedValueOnce([
          {
            migration_name: retriedMigrationName,
            finished_at: null,
            rolled_back_at: '2026-11-22T01:00:00.000Z',
          },
          ...appliedMigrationRows,
        ]);

      const retryRes = await readyRoute();
      expect(retryRes.status).toBe(200);
      expect(retryRes.headers.get('Cache-Control')).toBe('no-store');
      const retryJson = await retryRes.json();
      expect(retryJson.status).toBe('ready');
      expect(retryJson.database).toBe('connected');

      (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
      mockQueryRaw.mockReset();
      mockQueryRaw
        .mockResolvedValueOnce([...coreTableRows, { table_name: '_prisma_migrations' }])
        .mockResolvedValueOnce(
          appliedMigrationRows.map((row) =>
            row.migration_name === retriedMigrationName
              ? {
                ...row,
                finished_at: null,
                rolled_back_at: '2026-11-22T01:00:00.000Z',
              }
              : row
          )
        );

      const rolledBackOnlyRes = await readyRoute();
      expect(rolledBackOnlyRes.status).toBe(503);
      expect(rolledBackOnlyRes.headers.get('Cache-Control')).toBe('no-store');
      const rolledBackOnlyJson = await rolledBackOnlyRes.json();
      expect(rolledBackOnlyJson.status).toBe('unhealthy');
      expect(rolledBackOnlyJson.database).toBe('connected');
      expect(rolledBackOnlyJson.error).toContain('Missing required database migrations');
      expect(rolledBackOnlyJson.error).toContain(retriedMigrationName);
    });

    it('returns 503 Service Unavailable whenever any of the 16 required schema tables is missing and masks names in production', async () => {
      expect(REQUIRED_SCHEMA_TABLES).toHaveLength(16);

      for (const omittedTable of REQUIRED_SCHEMA_TABLES) {
        const subsetTables = coreTableRows.filter((row) => row.table_name !== omittedTable);

        (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
        mockQueryRaw.mockReset();
        mockQueryRaw.mockResolvedValueOnce([...subsetTables, { table_name: '_prisma_migrations' }]);

        const devRes = await readyRoute();
        expect(devRes.status).toBe(503);
        expect(devRes.headers.get('Cache-Control')).toBe('no-store');
        const devJson = await devRes.json();
        expect(devJson.status).toBe('unhealthy');
        expect(devJson.database).toBe('connected');
        expect(devJson.error).toContain('Missing required database tables');
        expect(devJson.error).toContain(omittedTable);

        (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
        mockQueryRaw.mockReset();
        mockQueryRaw.mockResolvedValueOnce([...subsetTables, { table_name: '_prisma_migrations' }]);

        const prodRes = await readyRoute();
        expect(prodRes.status).toBe(503);
        const prodJson = await prodRes.json();
        expect(prodJson.status).toBe('unhealthy');
        expect(prodJson.database).toBe('connected');
        expect(prodJson.error).toBe('Database schema is not ready');
        expect(prodJson.error).not.toContain(omittedTable);
      }
    });

    it('returns 503 Service Unavailable whenever any of the 47 required migrations is missing and masks names in production', async () => {
      expect(REQUIRED_MIGRATION_NAMES).toHaveLength(47);

      for (const omittedMigration of REQUIRED_MIGRATION_NAMES) {
        const subsetMigrations = appliedMigrationRows.filter(
          (row) => row.migration_name !== omittedMigration
        );

        (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
        mockQueryRaw.mockReset();
        mockQueryRaw
          .mockResolvedValueOnce([...coreTableRows, { table_name: '_prisma_migrations' }])
          .mockResolvedValueOnce(subsetMigrations);

        const devRes = await readyRoute();
        expect(devRes.status).toBe(503);
        expect(devRes.headers.get('Cache-Control')).toBe('no-store');
        const devJson = await devRes.json();
        expect(devJson.status).toBe('unhealthy');
        expect(devJson.database).toBe('connected');
        expect(devJson.error).toContain('Missing required database migrations');
        expect(devJson.error).toContain(omittedMigration);

        (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
        mockQueryRaw.mockReset();
        mockQueryRaw
          .mockResolvedValueOnce([...coreTableRows, { table_name: '_prisma_migrations' }])
          .mockResolvedValueOnce(subsetMigrations);

        const prodRes = await readyRoute();
        expect(prodRes.status).toBe(503);
        const prodJson = await prodRes.json();
        expect(prodJson.status).toBe('unhealthy');
        expect(prodJson.database).toBe('connected');
        expect(prodJson.error).toBe('Database schema is not ready');
        expect(prodJson.error).not.toContain(omittedMigration);
      }
    });

    it('returns 503 Service Unavailable on a zero-table database', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);

      const res = await readyRoute();
      expect(res.status).toBe(503);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      const json = await res.json();
      expect(json.status).toBe('unhealthy');
      expect(json.database).toBe('connected');
      expect(json.error).toContain('Missing required database tables');
      expect(json.error).toContain('AppConfig');
    });

    it('masks missing table details in production on a zero-table database', async () => {
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      mockQueryRaw.mockResolvedValueOnce([]);

      const res = await readyRoute();
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.status).toBe('unhealthy');
      expect(json.error).toBe('Database schema is not ready');
    });

    it('returns 503 Service Unavailable when _prisma_migrations contains a failed migration', async () => {
      (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
      const failedMigrationName = REQUIRED_MIGRATION_NAMES[REQUIRED_MIGRATION_NAMES.length - 1];
      mockQueryRaw
        .mockResolvedValueOnce([...coreTableRows, { table_name: '_prisma_migrations' }])
        .mockResolvedValueOnce(
          appliedMigrationRows.map((row) =>
            row.migration_name === failedMigrationName
              ? {
                ...row,
                finished_at: null,
                rolled_back_at: null,
              }
              : row
          )
        );

      const res = await readyRoute();
      expect(res.status).toBe(503);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      const json = await res.json();
      expect(json.status).toBe('unhealthy');
      expect(json.database).toBe('connected');
      expect(json.error).toContain('Failed or incomplete database migrations');
      expect(json.error).toContain(failedMigrationName);
    });

    it('masks failed migration names in production while returning 503', async () => {
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      const failedMigrationName = REQUIRED_MIGRATION_NAMES[REQUIRED_MIGRATION_NAMES.length - 1];
      mockQueryRaw
        .mockResolvedValueOnce([...coreTableRows, { table_name: '_prisma_migrations' }])
        .mockResolvedValueOnce(
          appliedMigrationRows.map((row) =>
            row.migration_name === failedMigrationName
              ? {
                ...row,
                finished_at: null,
                rolled_back_at: null,
              }
              : row
          )
        );

      const res = await readyRoute();
      expect(res.status).toBe(503);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      const json = await res.json();
      expect(json.status).toBe('unhealthy');
      expect(json.database).toBe('connected');
      expect(json.error).toBe('Database schema is not ready');
      expect(json.error).not.toContain(failedMigrationName);
    });

    it('returns 503 Service Unavailable when _prisma_migrations has zero applied migrations', async () => {
      mockQueryRaw
        .mockResolvedValueOnce([...coreTableRows, { table_name: '_prisma_migrations' }])
        .mockResolvedValueOnce([]);

      const res = await readyRoute();
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.status).toBe('unhealthy');
      expect(json.error).toContain('No applied database migrations');
    });

    it('returns 503 Service Unavailable with Cache-Control: no-store when database query fails', async () => {
      mockQueryRaw.mockRejectedValue(new Error('Connection refused'));
      const res = await readyRoute();
      expect(res.status).toBe(503);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      const json = await res.json();
      expect(json.status).toBe('unhealthy');
      expect(json.database).toBe('disconnected');
      expect(json.error).toBe('Connection refused');
    });

    it('masks internal database error messages in production while returning 503', async () => {
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      mockQueryRaw.mockRejectedValue(
        new Error('FATAL: password authentication failed for user "wedding" at 10.0.0.12:5432')
      );
      const res = await readyRoute();
      expect(res.status).toBe(503);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      const json = await res.json();
      expect(json.status).toBe('unhealthy');
      expect(json.database).toBe('disconnected');
      expect(json.error).toBe('Database connection failed');
    });

    it('shares one single-flight check and memoizes healthy results within a 5-second window running at most two SQL queries', async () => {
      mockQueryRaw
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              setTimeout(
                () => resolve([...coreTableRows, { table_name: '_prisma_migrations' }]),
                20
              );
            })
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              setTimeout(() => resolve(appliedMigrationRows), 20);
            })
        );

      const concurrentResponses = await Promise.all(
        Array.from({ length: 20 }, () =>
          readyRoute(new NextRequest('http://localhost:3000/api/ready'))
        )
      );

      for (const res of concurrentResponses) {
        expect(res.status).toBe(200);
        expect(res.headers.get('Cache-Control')).toBe('no-store');
        const body = await res.json();
        expect(body.status).toBe('ready');
      }

      // Subsequent call inside the 5-second healthy window should also reuse the memoized result
      const followUpRes = await readyRoute(new NextRequest('http://localhost:3000/api/ready'));
      expect(followUpRes.status).toBe(200);
      expect(followUpRes.headers.get('Cache-Control')).toBe('no-store');
      expect(mockQueryRaw).toHaveBeenCalledTimes(2);
    });

    it('returns HTTP 429 after 100 rapid unauthenticated requests within the burst window', async () => {
      mockQueryRaw
        .mockResolvedValueOnce([...coreTableRows, { table_name: '_prisma_migrations' }])
        .mockResolvedValueOnce(appliedMigrationRows);

      const statuses: number[] = [];
      for (let i = 0; i < 105; i += 1) {
        const req = new NextRequest('http://localhost:3000/api/ready', {
          headers: {
            'x-forwarded-for': '198.51.100.77',
          },
        });
        const res = await readyRoute(req);
        statuses.push(res.status);
        expect(res.headers.get('Cache-Control')).toBe('no-store');
      }

      expect(statuses.slice(0, 100).every((s) => s === 200)).toBe(true);
      expect(statuses.slice(100)).toEqual([429, 429, 429, 429, 429]);
      expect(mockQueryRaw).toHaveBeenCalledTimes(2);
    });
  });
});
