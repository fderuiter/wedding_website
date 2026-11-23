/** @jest-environment node */

jest.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn(),
  },
}));

import { GET as healthRoute } from '@/app/api/health/route';
import { GET as liveRoute } from '@/app/api/live/route';
import { GET as readyRoute } from '@/app/api/ready/route';
import { prisma } from '@/lib/prisma';

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
    it('returns 200 OK with status ok', async () => {
      mockQueryRaw.mockResolvedValue([{ '?column?': 1 }]);
      const res = await healthRoute();
      expect(res.status).toBe(200);
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
    it('returns 200 OK when database is connected', async () => {
      mockQueryRaw.mockResolvedValue([{ '?column?': 1 }]);
      const res = await readyRoute();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe('ready');
      expect(json.database).toBe('connected');
    });

    it('returns 503 Service Unavailable when database query fails', async () => {
      mockQueryRaw.mockRejectedValue(new Error('Connection refused'));
      const res = await readyRoute();
      expect(res.status).toBe(503);
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
      const json = await res.json();
      expect(json.status).toBe('unhealthy');
      expect(json.database).toBe('disconnected');
      expect(json.error).toBe('Database connection failed');
    });
  });
});
