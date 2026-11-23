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
    broadcastRecipient: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  },
}));

describe('GET /api/registry/validate-code', () => {
  const mockFindUnique = prisma.invitationCode.findUnique as jest.Mock;
  const mockRecipientUpdateMany = prisma.broadcastRecipient.updateMany as jest.Mock;

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

    mockFindUnique.mockResolvedValueOnce({ id: 'sample-1', code: 'SAMPLE12', guestName: 'Sample Guest', isSample: true });
    const sampleRes = await GET(new NextRequest('http://localhost/api/registry/validate-code?code=SAMPLE12'));
    expect(sampleRes.status).toBe(404);
    mockFindUnique.mockResolvedValueOnce({
      id: 'collect-1',
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
    expect(mockRecipientUpdateMany).not.toHaveBeenCalled();
  });

  test('issues guest_invite_session cookie and transitions SENT BroadcastRecipient rows to VIEWED on valid non-sample invitation code', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 'inv-valid-1',
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
    expect(mockRecipientUpdateMany).toHaveBeenCalledWith({
      where: {
        invitationCodeId: 'inv-valid-1',
        status: 'SENT',
      },
      data: {
        status: 'VIEWED',
      },
    });
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

  test('returns 200 with shared_passcode guidance and no invite cookie when code matches GUEST_PASSCODE', async () => {
    const prevPasscode = process.env.GUEST_PASSCODE;
    process.env.GUEST_PASSCODE = 'WEDDING2026';
    try {
      mockFindUnique.mockResolvedValueOnce(null);
      const res = await GET(
        new NextRequest('http://localhost/api/registry/validate-code?code=wedding2026')
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data).toMatchObject({
        valid: false,
        reason: 'shared_passcode',
      });
      expect(body.data.error).toMatch(/shared website passcode/i);
      expect(res.cookies.get(GUEST_INVITE_COOKIE)?.value).toBeUndefined();
      expect(mockFindUnique).toHaveBeenCalledWith({ where: { code: 'WEDDING2026' } });
    } finally {
      if (prevPasscode === undefined) {
        delete process.env.GUEST_PASSCODE;
      } else {
        process.env.GUEST_PASSCODE = prevPasscode;
      }
    }
  });
});
