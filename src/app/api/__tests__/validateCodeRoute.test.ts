/** @jest-environment node */

jest.mock('@/lib/prisma', () => ({
  prisma: {
    invitationCode: {
      findUnique: jest.fn(),
    },
  },
}));

import { GET as validateCodeRoute } from '@/app/api/registry/validate-code/route';
import { prisma } from '@/lib/prisma';

const mockFindUnique = prisma.invitationCode.findUnique as jest.Mock;

describe('validate-code Route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 if code parameter is missing', async () => {
    const req = new Request('http://localhost/api/registry/validate-code', {
      method: 'GET',
    });
    const res = await validateCodeRoute(req as any);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Code is required.');
  });

  it('returns 404 if invitation code is not found', async () => {
    mockFindUnique.mockResolvedValue(null);
    const req = new Request('http://localhost/api/registry/validate-code?code=INVALID1', {
      method: 'GET',
    });
    const res = await validateCodeRoute(req as any);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Invalid invitation code.');
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { code: 'INVALID1' },
    });
  });

  it('returns 400 if invitation code has already been used', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'invite-123',
      code: 'USEDCODE',
      guestName: 'John Doe',
      used: true,
    });
    const req = new Request('http://localhost/api/registry/validate-code?code=USEDCODE', {
      method: 'GET',
    });
    const res = await validateCodeRoute(req as any);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('This invitation code has already been used.');
  });

  it('returns 200 with guestName and valid: true for an active, unused code', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'invite-123',
      code: 'GOODCODE',
      guestName: 'Jane Smith',
      used: false,
    });
    const req = new Request('http://localhost/api/registry/validate-code?code=GOODCODE', {
      method: 'GET',
    });
    const res = await validateCodeRoute(req as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      success: true,
      data: {
        valid: true,
        guestName: 'Jane Smith',
        code: 'GOODCODE',
      }
    });
  });
});
