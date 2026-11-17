/** @jest-environment node */

import { NextRequest } from 'next/server';
import { GET } from '../route';
import { getEntityService } from '@/features/admin';
import { signAdminToken } from '@/core/auth/auth.server';

jest.mock('@/features/admin', () => ({
  getEntityService: jest.fn(),
}));

describe('GET /api/admin/[entity] - Server-Side Pagination', () => {
  let mockService: {
    findMany: jest.Mock;
    count: jest.Mock;
  };
  let adminAuthCookie: string;

  beforeAll(async () => {
    process.env.ADMIN_PASSWORD =
      'scrypt:8R6mvU36W2Cqp3C8vq+r1g==:XlhFCFplIJUauzo9FzPUPVgA5458RRwbTpQtFCRWjoLN4AI6VCH76jOksMQdQX/5f45ALowp67Xxo58mFrcb3g==';
    const token = await signAdminToken({ isAdmin: true, iat: Date.now() });
    adminAuthCookie = `admin_auth=${token}`;
  });

  beforeEach(() => {
    jest.clearAllMocks();

    mockService = {
      findMany: jest.fn(),
      count: jest.fn(),
    };

    (getEntityService as jest.Mock).mockResolvedValue({
      service: mockService,
    });
  });

  const createRequest = (url: string) => {
    return new NextRequest(url, {
      method: 'GET',
      headers: {
        cookie: adminAuthCookie,
      },
    });
  };

  it('returns 404 when entity is not found', async () => {
    (getEntityService as jest.Mock).mockResolvedValue(null);

    const req = createRequest('http://localhost/api/admin/unknown-entity');
    const res = await GET(req, { params: Promise.resolve({ entity: 'unknown-entity' }) });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toBe('Entity not found');
  });

  describe('Default pagination (omitted parameters)', () => {
    it('applies default limit of 50 and skip of 0, returning pagination headers', async () => {
      const records = Array.from({ length: 50 }, (_, i) => ({ id: `rec-${i + 1}`, name: `Item ${i + 1}` }));
      mockService.count.mockResolvedValue(120);
      mockService.findMany.mockResolvedValue(records);

      const req = createRequest('http://localhost/api/admin/invitation-codes');
      const res = await GET(req, { params: Promise.resolve({ entity: 'invitation-codes' }) });

      expect(res.status).toBe(200);
      expect(mockService.findMany).toHaveBeenCalledWith({
        take: 50,
        skip: 0,
        orderBy: { createdAt: 'desc' },
      });
      expect(mockService.count).toHaveBeenCalled();

      // Headers verification
      expect(res.headers.get('X-Total-Count')).toBe('120');
      expect(res.headers.get('X-Page')).toBe('1');
      expect(res.headers.get('X-Limit')).toBe('50');
      expect(res.headers.get('X-Total-Pages')).toBe('3');
      expect(res.headers.get('X-Per-Page')).toBe('50');
      expect(res.headers.get('X-Current-Page')).toBe('1');
      expect(res.headers.get('X-Has-Next-Page')).toBe('true');
      expect(res.headers.get('X-Has-Prev-Page')).toBe('false');
      expect(res.headers.get('X-Next-Cursor')).toBe('rec-50');

      // Body verification: keeps standard JSON response format
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(50);
      expect(body.data[0].id).toBe('rec-1');
    });
  });

  describe('Limit capping', () => {
    it('clamps limit above 100 down to 100 items', async () => {
      const records = Array.from({ length: 100 }, (_, i) => ({ id: `rec-${i + 1}` }));
      mockService.count.mockResolvedValue(250);
      mockService.findMany.mockResolvedValue(records);

      const req = createRequest('http://localhost/api/admin/invitation-codes?limit=500');
      const res = await GET(req, { params: Promise.resolve({ entity: 'invitation-codes' }) });

      expect(res.status).toBe(200);
      expect(mockService.findMany).toHaveBeenCalledWith({
        take: 100,
        skip: 0,
        orderBy: { createdAt: 'desc' },
      });
      expect(res.headers.get('X-Limit')).toBe('100');
      expect(res.headers.get('X-Total-Pages')).toBe('3');
    });
  });

  describe('Invalid parameter rejection (HTTP 400)', () => {
    it('rejects negative page parameter with HTTP 400', async () => {
      const req = createRequest('http://localhost/api/admin/invitation-codes?page=-1');
      const res = await GET(req, { params: Promise.resolve({ entity: 'invitation-codes' }) });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Invalid page parameter');
      expect(mockService.findMany).not.toHaveBeenCalled();
    });

    it('rejects page=0 with HTTP 400', async () => {
      const req = createRequest('http://localhost/api/admin/invitation-codes?page=0');
      const res = await GET(req, { params: Promise.resolve({ entity: 'invitation-codes' }) });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Invalid page parameter');
    });

    it('rejects non-numeric page parameter with HTTP 400', async () => {
      const req = createRequest('http://localhost/api/admin/invitation-codes?page=abc');
      const res = await GET(req, { params: Promise.resolve({ entity: 'invitation-codes' }) });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Invalid page parameter');
    });

    it('rejects negative limit parameter with HTTP 400', async () => {
      const req = createRequest('http://localhost/api/admin/invitation-codes?limit=-5');
      const res = await GET(req, { params: Promise.resolve({ entity: 'invitation-codes' }) });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Invalid limit parameter');
    });

    it('rejects limit=0 with HTTP 400', async () => {
      const req = createRequest('http://localhost/api/admin/invitation-codes?limit=0');
      const res = await GET(req, { params: Promise.resolve({ entity: 'invitation-codes' }) });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Invalid limit parameter');
    });

    it('rejects non-numeric limit parameter with HTTP 400', async () => {
      const req = createRequest('http://localhost/api/admin/invitation-codes?limit=invalid');
      const res = await GET(req, { params: Promise.resolve({ entity: 'invitation-codes' }) });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Invalid limit parameter');
    });

    it('rejects negative skip parameter with HTTP 400', async () => {
      const req = createRequest('http://localhost/api/admin/invitation-codes?skip=-10');
      const res = await GET(req, { params: Promise.resolve({ entity: 'invitation-codes' }) });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Invalid skip parameter');
    });
  });

  describe('Offset pagination', () => {
    it('applies page and limit to calculate skip correctly', async () => {
      mockService.count.mockResolvedValue(100);
      mockService.findMany.mockResolvedValue([{ id: 'rec-21' }, { id: 'rec-22' }]);

      const req = createRequest('http://localhost/api/admin/invitation-codes?page=3&limit=10');
      const res = await GET(req, { params: Promise.resolve({ entity: 'invitation-codes' }) });

      expect(res.status).toBe(200);
      expect(mockService.findMany).toHaveBeenCalledWith({
        take: 10,
        skip: 20, // (3 - 1) * 10
        orderBy: { createdAt: 'desc' },
      });

      expect(res.headers.get('X-Total-Count')).toBe('100');
      expect(res.headers.get('X-Page')).toBe('3');
      expect(res.headers.get('X-Limit')).toBe('10');
      expect(res.headers.get('X-Total-Pages')).toBe('10');
      expect(res.headers.get('X-Has-Next-Page')).toBe('true');
      expect(res.headers.get('X-Has-Prev-Page')).toBe('true');
    });
  });

  describe('Cursor navigation', () => {
    it('applies cursor parameter and defaults skip to 1', async () => {
      mockService.count.mockResolvedValue(50);
      mockService.findMany.mockResolvedValue([{ id: 'rec-6' }, { id: 'rec-7' }]);

      const req = createRequest('http://localhost/api/admin/invitation-codes?cursor=rec-5&limit=2');
      const res = await GET(req, { params: Promise.resolve({ entity: 'invitation-codes' }) });

      expect(res.status).toBe(200);
      expect(mockService.findMany).toHaveBeenCalledWith({
        take: 2,
        skip: 1,
        cursor: { id: 'rec-5' },
        orderBy: { createdAt: 'desc' },
      });
      expect(res.headers.get('X-Next-Cursor')).toBe('rec-7');
    });

    it('respects explicit skip alongside cursor', async () => {
      mockService.count.mockResolvedValue(50);
      mockService.findMany.mockResolvedValue([{ id: 'rec-5' }]);

      const req = createRequest('http://localhost/api/admin/invitation-codes?cursor=rec-5&skip=0&limit=1');
      const res = await GET(req, { params: Promise.resolve({ entity: 'invitation-codes' }) });

      expect(res.status).toBe(200);
      expect(mockService.findMany).toHaveBeenCalledWith({
        take: 1,
        skip: 0,
        cursor: { id: 'rec-5' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('Custom sort parameters', () => {
    it('passes custom orderBy and orderDir to service', async () => {
      mockService.count.mockResolvedValue(10);
      mockService.findMany.mockResolvedValue([]);

      const req = createRequest('http://localhost/api/admin/invitation-codes?orderBy=guestName&orderDir=asc');
      const res = await GET(req, { params: Promise.resolve({ entity: 'invitation-codes' }) });

      expect(res.status).toBe(200);
      expect(mockService.findMany).toHaveBeenCalledWith({
        take: 50,
        skip: 0,
        orderBy: { guestName: 'asc' },
      });
    });
  });

  describe('Empty result set', () => {
    it('handles zero total items gracefully with valid pagination headers', async () => {
      mockService.count.mockResolvedValue(0);
      mockService.findMany.mockResolvedValue([]);

      const req = createRequest('http://localhost/api/admin/invitation-codes');
      const res = await GET(req, { params: Promise.resolve({ entity: 'invitation-codes' }) });

      expect(res.status).toBe(200);
      expect(res.headers.get('X-Total-Count')).toBe('0');
      expect(res.headers.get('X-Total-Pages')).toBe('0');
      expect(res.headers.get('X-Page')).toBe('1');
      expect(res.headers.get('X-Limit')).toBe('50');
      expect(res.headers.get('X-Has-Next-Page')).toBe('false');
      expect(res.headers.get('X-Has-Prev-Page')).toBe('false');
      expect(res.headers.get('X-Next-Cursor')).toBeNull();

      const body = await res.json();
      expect(body).toEqual({
        success: true,
        data: [],
      });
    });
  });
});
