/** @jest-environment node */

import { NextRequest } from 'next/server';
import { GET } from '../route';
import { prisma } from '@/lib/prisma';
import { resetRateLimitsForTesting } from '@/utils/rateLimit';
import { GUEST_INVITE_COOKIE } from '@/core/auth/guestInviteSession';
import { base64urlDecode } from '@/utils/crypto';

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
    const missingRes = await GET(
      new NextRequest('http://localhost/api/registry/validate-code?code=NOPE1234')
    );
    expect(missingRes.status).toBe(404);

    mockFindUnique.mockResolvedValueOnce({
      code: 'SAMPLE12',
      guestName: 'Sample Guest',
      isSample: true,
    });
    const sampleRes = await GET(
      new NextRequest('http://localhost/api/registry/validate-code?code=SAMPLE12')
    );
    expect(sampleRes.status).toBe(404);
  });

  test('returns email from PostgreSQL for receipt prefill while keeping guest_invite_session cookie free of email PII', async () => {
    mockFindUnique.mockResolvedValueOnce({
      code: 'VALID123',
      guestName: 'Alex & Sam',
      email: 'alex@example.com',
      isSample: false,
    });

    const res = await GET(
      new NextRequest('http://localhost/api/registry/validate-code?code=valid123')
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({
      valid: true,
      guestName: 'Alex & Sam',
      email: 'alex@example.com',
      code: 'VALID123',
    });

    const cookieVal = res.cookies.get(GUEST_INVITE_COOKIE)?.value;
    expect(cookieVal).toBeTruthy();
    const decodedCookieJson = base64urlDecode(cookieVal!.split('.')[0]);
    expect(decodedCookieJson).not.toContain('alex@example.com');
    expect(JSON.parse(decodedCookieJson)).not.toHaveProperty('email');
  });

  test('enforces dedicated 20-attempt lookup rate limit per 15 minutes and returns 429 on 21st attempt', async () => {
    mockFindUnique.mockResolvedValue(null);

    for (let i = 1; i <= 20; i++) {
      const req = new NextRequest(
        `http://localhost/api/registry/validate-code?code=MARK${String(i).padStart(4, '0')}`
      );
      const res = await GET(req);
      expect(res.status).toBe(404);
    }

    const req21 = new NextRequest('http://localhost/api/registry/validate-code?code=MARK0021');
    const res21 = await GET(req21);
    expect(res21.status).toBe(429);
    const body = await res21.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/too many requests/i);
  });
});
