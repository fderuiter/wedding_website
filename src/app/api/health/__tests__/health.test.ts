/** @jest-environment node */

import { GET } from '../route';
import { prisma } from '@/lib/prisma';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn(),
  },
}));

describe('Health Check API Route', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns 200 OK when database is healthy', async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ '?column?': 1 }]);

    const req = new Request('http://localhost/api/health', { method: 'GET' });
    const response = await GET(req as any, {});
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.status).toBe('ok');
    expect(data.data.database).toBe('connected');
    expect(data.data.timestamp).toBeDefined();
  });

  it('returns 503 Service Unavailable when database is unreachable', async () => {
    (prisma.$queryRaw as jest.Mock).mockRejectedValue(new Error('DB Connection Error'));

    const req = new Request('http://localhost/api/health', { method: 'GET' });
    const response = await GET(req as any, {});
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Database connection failed');
  });
});
