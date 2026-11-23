/** @jest-environment node */

import { NextRequest } from 'next/server';
import { GET } from '../route';
import { prisma } from '@/lib/prisma';
import { resetRateLimitsForTesting } from '@/utils/rateLimit';
import { GUEST_INVITE_COOKIE } from '@/core/auth/guestInviteSession';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    invitationCode: {
      findUnique: jest.fn(),
    },
  },
}));

describe('GET /api/registry/validate-code', () => {
  const mockFindUnique = prisma.invitationCode.findUnique as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimitsForTesting();
  });

  test('returns 400 when code query parameter is missing', async () => {
    const req = new NextRequest('http://localhost/api/registry/validate-code');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  test('returns 404 when invitation code does not exist or is sample data', async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    const missingRes = await GET(new NextRequest('http://localhost/api/registry/validate-code?code=NOPE1234'));
    expect(missingRes.status).toBe(404);

    mockFindUnique.mockResolvedValueOnce({ code: 'SAMPLE12', guestName: 'Sample Guest', isSample: true });
    const sampleRes = await GET(new NextRequest('http://localhost/api/registry/validate-code?code=SAMPLE12'));
    expect(sampleRes.status).toBe(404);

    mockFindUnique.mockResolvedValueOnce({
      code: 'COLLECT1',
      guestName: 'Address Collector',
      isSample: false,
      partyTags: ['address-collection'],
    });
    const collectRes = await GET(
      new NextRequest('http://localhost/api/registry/validate-code?code=COLLECT1')
    );
    expect(collectRes.status).toBe(404);
    expect(collectRes.cookies.get(GUEST_INVITE_COOKIE)).toBeUndefined();
  });

  test('issues guest_invite_session cookie on valid non-sample invitation code', async () => {
    mockFindUnique.mockResolvedValueOnce({
      code: 'VALID123',
      guestName: 'Alex & Sam',
      isSample: false,
    });

    const res = await GET(new NextRequest('http://localhost/api/registry/validate-code?code=valid123'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({
      valid: true,
      guestName: 'Alex & Sam',
      code: 'VALID123',
    });
    expect(res.cookies.get(GUEST_INVITE_COOKIE)?.value).toBeTruthy();
  });

  test('enforces 5-attempt lockout per 15 minutes and returns 429 on 6th attempt', async () => {
    mockFindUnique.mockResolvedValue(null);

    for (let i = 1; i <= 5; i++) {
      const req = new NextRequest(`http://localhost/api/registry/validate-code?code=MARK000${i}`);
      const res = await GET(req);
      expect(res.status).toBe(404);
    }

    const req6 = new NextRequest('http://localhost/api/registry/validate-code?code=MARK0006');
    const res6 = await GET(req6);
    expect(res6.status).toBe(429);
    const body = await res6.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/too many requests/i);
  });
});
