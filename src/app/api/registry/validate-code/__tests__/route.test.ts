/** @jest-environment node */

import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import * as validateCodeRouteModule from '../route';
import { POST } from '../route';
import { POST as guestLoginPost } from '@/app/api/guest/login/route';
import { POST as adminLoginPost } from '@/app/api/admin/login/route';
import { prisma } from '@/lib/prisma';
import { rateLimit, resetRateLimitsForTesting } from '@/utils/rateLimit';
import { GUEST_INVITE_COOKIE } from '@/core/auth/guestInviteSession';
import { GUEST_COOKIE } from '@/core/auth/guest.server';
import { ADMIN_COOKIE } from '@/core/auth/auth.server';
import { env } from '@/env';

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

describe('/api/registry/validate-code', () => {
  const mockFindUnique = prisma.invitationCode.findUnique as jest.Mock;
  const mockRecipientUpdateMany = prisma.broadcastRecipient.updateMany as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimitsForTesting();
  });

  test('does not export a GET handler and returns 400 on POST when code is missing', async () => {
    expect((validateCodeRouteModule as Record<string, unknown>).GET).toBeUndefined();

    const req = new NextRequest('http://localhost/api/registry/validate-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test('POST returns 404 when invitation code does not exist, is sample data, or is address-collection only', async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    const missingRes = await POST(
      new NextRequest('http://localhost/api/registry/validate-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'NOPE1234' }),
      })
    );
    expect(missingRes.status).toBe(404);

    mockFindUnique.mockResolvedValueOnce({
      id: 'sample-1',
      code: 'SAMPLE12',
      guestName: 'Sample Guest',
      isSample: true,
    });
    const sampleRes = await POST(
      new NextRequest('http://localhost/api/registry/validate-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'SAMPLE12' }),
      })
    );
    expect(sampleRes.status).toBe(404);

    mockFindUnique.mockResolvedValueOnce({
      id: 'collect-1',
      code: 'COLLECT1',
      guestName: 'Address Collector',
      isSample: false,
      partyTags: ['address-collection'],
    });
    const collectRes = await POST(
      new NextRequest('http://localhost/api/registry/validate-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'COLLECT1' }),
      })
    );
    expect(collectRes.status).toBe(404);
    expect(collectRes.cookies.get(GUEST_INVITE_COOKIE)).toBeUndefined();
    expect(mockRecipientUpdateMany).not.toHaveBeenCalled();
  });

  test('POST issues guest_invite_session cookie, omits email PII, and transitions SENT BroadcastRecipient rows to VIEWED (including legacy <8-char DB rows)', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 'inv-valid-1',
      code: 'VALID123',
      guestName: 'Alex & Sam',
      email: 'alex.sam@example.com',
      isSample: false,
    });

    const res = await POST(
      new NextRequest('http://localhost/api/registry/validate-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'valid123' }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({
      valid: true,
      guestName: 'Alex & Sam',
      code: 'VALID123',
    });
    expect(body.data.email).toBeUndefined();
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

    mockFindUnique.mockResolvedValueOnce({
      id: 'inv-legacy-1',
      code: 'VIP26',
      guestName: 'Legacy Household',
      email: 'legacy@example.com',
      isSample: false,
    });
    const legacyRes = await POST(
      new NextRequest('http://localhost/api/registry/validate-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'vip26' }),
      })
    );
    expect(legacyRes.status).toBe(200);
    const legacyBody = await legacyRes.json();
    expect(legacyBody.data).toEqual({
      valid: true,
      guestName: 'Legacy Household',
      code: 'VIP26',
    });
  });

  test('POST rejects cross-site Fetch Metadata with 403 and non-JSON Content-Type with 415', async () => {
    const crossSiteRes = await POST(
      new NextRequest('http://localhost/api/registry/validate-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Sec-Fetch-Site': 'cross-site',
        },
        body: JSON.stringify({ code: 'VALID123' }),
      })
    );
    expect(crossSiteRes.status).toBe(403);
    expect(mockFindUnique).not.toHaveBeenCalled();

    const textPlainRes = await POST(
      new NextRequest('http://localhost/api/registry/validate-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
        },
        body: '{"code":"VALID123"}',
      })
    );
    expect(textPlainRes.status).toBe(415);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  test('enforces 5-attempt lockout per 15 minutes and returns 429 on 6th attempt', async () => {
    mockFindUnique.mockResolvedValue(null);

    for (let i = 1; i <= 5; i++) {
      const req = new NextRequest('http://localhost/api/registry/validate-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: `MARK000${i}` }),
      });
      const res = await POST(req);
      expect(res.status).toBe(404);
    }

    const req6 = new NextRequest('http://localhost/api/registry/validate-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'MARK0006' }),
    });
    const res6 = await POST(req6);
    expect(res6.status).toBe(429);
    const body = await res6.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/too many requests/i);
  });

  test('returns 401 with shared_passcode reason on exact-case GUEST_PASSCODE, counts toward AuthLockout, and returns 404 on wrong-case GUEST_PASSCODE', async () => {
    const prevPasscode = process.env.GUEST_PASSCODE;
    process.env.GUEST_PASSCODE = 'Wedding2026';
    try {
      mockFindUnique.mockResolvedValue(null);

      // Wrong-case input does NOT reveal GUEST_PASSCODE; returns generic 404
      const wrongCaseRes = await POST(
        new NextRequest('http://localhost/api/registry/validate-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: 'wedding2026' }),
        })
      );
      expect(wrongCaseRes.status).toBe(404);
      const wrongCaseBody = await wrongCaseRes.json();
      expect(wrongCaseBody.reason).toBeUndefined();

      // Exact-case input returns 401 with shared_passcode guidance and increments AuthLockout
      for (let attempt = 2; attempt <= 5; attempt++) {
        const postRes = await POST(
          new NextRequest('http://localhost/api/registry/validate-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: 'Wedding2026' }),
          })
        );
        expect(postRes.status).toBe(401);
        const postBody = await postRes.json();
        expect(postBody).toMatchObject({
          success: false,
          valid: false,
          reason: 'shared_passcode',
        });
        expect(postBody.error).toMatch(/shared website passcode/i);
        expect(postRes.cookies.get(GUEST_INVITE_COOKIE)?.value).toBeUndefined();
      }
      expect(mockRecipientUpdateMany).not.toHaveBeenCalled();

      // 6th failed attempt (1 wrong-case 404 + 4 exact-case 401s = 5 failures) triggers 429 lockout
      const lockedOutRes = await POST(
        new NextRequest('http://localhost/api/registry/validate-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: 'Wedding2026' }),
        })
      );
      expect(lockedOutRes.status).toBe(429);
    } finally {
      if (prevPasscode === undefined) {
        delete process.env.GUEST_PASSCODE;
      } else {
        process.env.GUEST_PASSCODE = prevPasscode;
      }
    }
  });

  test('repeated POST checks for one code reuse incoming cookie and share one canonical household rate-limit bucket', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'inv-household-1',
      code: 'HOUSEHOLD1',
      guestName: 'The Miller Household',
      isSample: false,
    });

    const firstRes = await POST(
      new NextRequest('http://localhost/api/registry/validate-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'household1' }),
      })
    );
    expect(firstRes.status).toBe(200);
    const firstToken = firstRes.cookies.get(GUEST_INVITE_COOKIE)?.value;
    expect(firstToken).toBeTruthy();

    await new Promise((resolve) => setTimeout(resolve, 5));

    // Re-checking with valid incoming cookie reuses the exact same token instead of minting a new one
    const reusedRes = await POST(
      new NextRequest('http://localhost/api/registry/validate-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `${GUEST_INVITE_COOKIE}=${firstToken}`,
        },
        body: JSON.stringify({ code: 'HOUSEHOLD1' }),
      })
    );
    expect(reusedRes.status).toBe(200);
    expect(reusedRes.cookies.get(GUEST_INVITE_COOKIE)?.value).toBe(firstToken);

    // Even when a caller omits the cookie to obtain a second distinct token, both share one household bucket
    const uncookieSecondRes = await POST(
      new NextRequest('http://localhost/api/registry/validate-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'HOUSEHOLD1' }),
      })
    );
    const secondToken = uncookieSecondRes.cookies.get(GUEST_INVITE_COOKIE)?.value;
    expect(secondToken).toBeTruthy();
    expect(secondToken).not.toBe(firstToken);

    const reqWithFirstToken = new NextRequest('http://localhost/api/registry/items', {
      headers: { cookie: `${GUEST_INVITE_COOKIE}=${firstToken}` },
    });
    const reqWithSecondToken = new NextRequest('http://localhost/api/registry/items', {
      headers: { cookie: `${GUEST_INVITE_COOKIE}=${secondToken}` },
    });

    expect(await rateLimit(reqWithFirstToken, 1, 60_000)).toBeNull();
    expect((await rateLimit(reqWithSecondToken, 1, 60_000))?.status).toBe(429);
  });

  test('reuses valid incoming cookies on guest and admin login and rejects 257-char login secrets before scrypt', async () => {
    const previousAdminPassword = process.env.ADMIN_PASSWORD;
    process.env.ADMIN_PASSWORD =
      'scrypt:8R6mvU36W2Cqp3C8vq+r1g==:XlhFCFplIJUauzo9FzPUPVgA5458RRwbTpQtFCRWjoLN4AI6VCH76jOksMQdQX/5f45ALowp67Xxo58mFrcb3g==';
    const scryptSpy = jest.spyOn(crypto, 'scrypt');

    try {
      // 1. 257-char secrets rejected before scrypt on admin login, guest login, and validate-code
      const oversizedAdminRes = await adminLoginPost(
        new NextRequest('http://localhost/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: 'a'.repeat(257) }),
        })
      );
      expect(oversizedAdminRes.status).toBe(400);

      const oversizedGuestRes = await guestLoginPost(
        new NextRequest('http://localhost/api/guest/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ passcode: 'p'.repeat(257) }),
        })
      );
      expect(oversizedGuestRes.status).toBe(400);

      const oversizedPostCodeRes = await POST(
        new NextRequest('http://localhost/api/registry/validate-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: 'C'.repeat(257) }),
        })
      );
      expect(oversizedPostCodeRes.status).toBe(400);
      expect(scryptSpy).not.toHaveBeenCalled();

      // 2. Guest shared-passcode login reuses valid incoming guest_auth cookie (preserving jti)
      const guestRes1 = await guestLoginPost(
        new NextRequest('http://localhost/api/guest/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ passcode: env.GUEST_PASSCODE }),
        })
      );
      expect(guestRes1.status).toBe(200);
      const guestToken1 = guestRes1.cookies.get(GUEST_COOKIE)?.value;
      expect(guestToken1).toBeTruthy();

      const guestRes2 = await guestLoginPost(
        new NextRequest('http://localhost/api/guest/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            cookie: `${GUEST_COOKIE}=${guestToken1}`,
          },
          body: JSON.stringify({ passcode: env.GUEST_PASSCODE }),
        })
      );
      expect(guestRes2.status).toBe(200);
      expect(guestRes2.cookies.get(GUEST_COOKIE)?.value).toBe(guestToken1);

      // 2b. Guest invitation-code login reuses valid incoming guest_invite_session cookie
      mockFindUnique.mockResolvedValue({
        id: 'inv-login-reuse-1',
        code: 'INVREUSE1',
        guestName: 'Taylor Household',
        isSample: false,
      });
      const inviteLoginRes1 = await guestLoginPost(
        new NextRequest('http://localhost/api/guest/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ passcode: 'invreuse1' }),
        })
      );
      expect(inviteLoginRes1.status).toBe(200);
      const inviteLoginToken1 = inviteLoginRes1.cookies.get(GUEST_INVITE_COOKIE)?.value;
      expect(inviteLoginToken1).toBeTruthy();

      await new Promise((resolve) => setTimeout(resolve, 5));

      const inviteLoginRes2 = await guestLoginPost(
        new NextRequest('http://localhost/api/guest/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            cookie: `${GUEST_INVITE_COOKIE}=${inviteLoginToken1}`,
          },
          body: JSON.stringify({ passcode: 'INVREUSE1' }),
        })
      );
      expect(inviteLoginRes2.status).toBe(200);
      expect(inviteLoginRes2.cookies.get(GUEST_INVITE_COOKIE)?.value).toBe(inviteLoginToken1);

      // 3. Admin login reuses valid incoming admin_auth cookie
      const adminRes1 = await adminLoginPost(
        new NextRequest('http://localhost/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: 'secret' }),
        })
      );
      expect(adminRes1.status).toBe(200);
      const adminToken1 = adminRes1.cookies.get(ADMIN_COOKIE)?.value;
      expect(adminToken1).toBeTruthy();

      await new Promise((resolve) => setTimeout(resolve, 5));

      const adminRes2 = await adminLoginPost(
        new NextRequest('http://localhost/api/admin/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            cookie: `${ADMIN_COOKIE}=${adminToken1}`,
          },
          body: JSON.stringify({ password: 'secret' }),
        })
      );
      expect(adminRes2.status).toBe(200);
      expect(adminRes2.cookies.get(ADMIN_COOKIE)?.value).toBe(adminToken1);
    } finally {
      scryptSpy.mockRestore();
      if (previousAdminPassword === undefined) {
        delete process.env.ADMIN_PASSWORD;
      } else {
        process.env.ADMIN_PASSWORD = previousAdminPassword;
      }
    }
  });
});
