/** @jest-environment node */

jest.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn(),
  },
}));

import { GET as healthRoute } from '@/app/api/health/route';
import { prisma } from '@/lib/prisma';

const mockQueryRaw = prisma.$queryRaw as jest.Mock;

describe('Health Route (/api/health)', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.clearAllMocks();
    (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
  });

  afterAll(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
  });

  it('returns 200 OK with connected database when query succeeds', async () => {
    mockQueryRaw.mockResolvedValue([{ '?column?': 1 }]);

    const req = new Request('http://localhost/api/health', {
      method: 'GET',
    });
    const res = await healthRoute(req as any, {});
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('ok');
    expect(json.data.database).toBe('connected');
    expect(json.data.timestamp).toBeDefined();
  });

  it('returns 503 Service Unavailable with disconnected database when query fails', async () => {
    mockQueryRaw.mockRejectedValue(new Error('DB connection failed'));

    const req = new Request('http://localhost/api/health', {
      method: 'GET',
    });
    const res = await healthRoute(req as any, {});
    expect(res.status).toBe(503);

    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.status).toBe('degraded');
    expect(json.database).toBe('disconnected');
    expect(typeof json.timestamp).toBe('string');
    expect(json.error).toBe('Database connection failed');
  });

  it('returns 503 in development mode preserving status, database, and timestamp fields', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
    mockQueryRaw.mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:5432'));

    const req = new Request('http://localhost/api/health', {
      method: 'GET',
    });
    const res = await healthRoute(req as any, {});
    expect(res.status).toBe(503);

    const json = await res.json();
    expect(json).toEqual({
      success: false,
      status: 'degraded',
      database: 'disconnected',
      timestamp: expect.any(String),
      error: 'Database connection failed',
    });
  });

  it('returns 503 in production mode preserving diagnostic fields with sanitized error text', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    mockQueryRaw.mockRejectedValue(
      new Error('connection to server at "postgres://wedding:secret@db.internal:5432/wedding" failed')
    );

    const req = new Request('http://localhost/api/health', {
      method: 'GET',
    });
    const res = await healthRoute(req as any, {});
    expect(res.status).toBe(503);

    const json = await res.json();
    expect(json).toEqual({
      success: false,
      status: 'degraded',
      database: 'disconnected',
      timestamp: expect.any(String),
      error: 'Database connection failed',
    });
    expect(JSON.stringify(json)).not.toContain('postgres://');
    expect(JSON.stringify(json)).not.toContain('db.internal');
  });
});
