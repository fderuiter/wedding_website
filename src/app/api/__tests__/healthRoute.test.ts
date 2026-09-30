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

    const res = await healthRoute();
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.status).toBe('ok');
    expect(json.database).toBe('connected');
    expect(json.timestamp).toBeDefined();
  });

  it('returns 503 Service Unavailable with disconnected database when query fails', async () => {
    mockQueryRaw.mockRejectedValue(new Error('DB connection failed'));

    const res = await healthRoute();
    expect(res.status).toBe(503);

    const json = await res.json();
    expect(json.status).toBe('degraded');
    expect(json.database).toBe('disconnected');
    expect(json.timestamp).toBeDefined();
  });
});
