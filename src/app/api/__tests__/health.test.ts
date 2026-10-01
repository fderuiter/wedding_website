/** @jest-environment node */

jest.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn(),
  },
}));

import { GET as healthRoute } from '@/app/api/health/route';
import { GET as readyRoute } from '@/app/api/ready/route';
import { prisma } from '@/lib/prisma';

const mockQueryRaw = prisma.$queryRaw as jest.Mock;

describe('Health and Readiness Endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/health (Liveness)', () => {
    it('returns 200 OK with status ok', async () => {
      mockQueryRaw.mockResolvedValue([{ '?column?': 1 }]);
      const res = await healthRoute();
      expect(res.status).toBe(200);
      const json = await res.json();
      const status = json.data?.status || json.status;
      expect(status).toBe('ok');
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
  });
});
