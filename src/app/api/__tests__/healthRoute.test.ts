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
  beforeEach(() => {
    jest.clearAllMocks();
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
    expect(json.error).toBe('Database connection failed');
  });
});
