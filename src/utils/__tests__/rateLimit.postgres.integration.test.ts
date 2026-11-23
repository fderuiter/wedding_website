/** @jest-environment node */

jest.unmock('@prisma/client');
jest.unmock('@prisma/adapter-pg');
jest.unmock('pg');
jest.unmock('@/lib/prisma');

import { NextRequest } from 'next/server';
import { prisma, getPgPool } from '@/lib/prisma';
import {
  createAuthLockoutInstance,
  hashAuthLockoutKey,
  resetRateLimitsForTesting,
} from '@/utils/rateLimit';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { POST as guestLoginPost } from '@/app/api/guest/login/route';
import { DatabaseBackupSchema } from '@/utils/backupValidation';

describe('PostgreSQL Multi-Instance Auth Lockout & Guest Login Integration', () => {
  const originalTrustProxy = process.env.TRUST_PROXY;
  const originalGuestPasscode = process.env.GUEST_PASSCODE;

  beforeEach(async () => {
    process.env.TRUST_PROXY = '2';
    process.env.GUEST_PASSCODE = 'wedding2026';
    resetRateLimitsForTesting();
    await prisma.authLockout.deleteMany();
    await prisma.invitationCode.deleteMany({
      where: { code: 'LOCKOUT_HOUSEHOLD_26' },
    });
  });

  afterAll(async () => {
    if (originalTrustProxy === undefined) {
      delete process.env.TRUST_PROXY;
    } else {
      process.env.TRUST_PROXY = originalTrustProxy;
    }
    if (originalGuestPasscode === undefined) {
      delete process.env.GUEST_PASSCODE;
    } else {
      process.env.GUEST_PASSCODE = originalGuestPasscode;
    }
    await prisma.authLockout.deleteMany();
    await prisma.invitationCode.deleteMany({
      where: { code: 'LOCKOUT_HOUSEHOLD_26' },
    });
    await prisma.$disconnect();
  });

  test('permits 10 consecutive valid /api/guest/login requests (shared passcode and household code) from one IP behind Cloud Run 2-hop XFF, then locks out on 6th failed attempt', async () => {
    await prisma.invitationCode.create({
      data: {
        code: 'LOCKOUT_HOUSEHOLD_26',
        guestName: 'Jordan & Avery',
        isSample: false,
      },
    });

    const cloudRunXff = '203.0.113.144:52100, 34.107.200.9';

    // 10 consecutive valid logins from the exact same client IP succeed with HTTP 200
    for (let i = 0; i < 10; i++) {
      const codeToUse = i % 2 === 0 ? 'wedding2026' : 'LOCKOUT_HOUSEHOLD_26';
      const req = new NextRequest('http://localhost/api/guest/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': cloudRunXff,
        },
        body: JSON.stringify({ passcode: codeToUse }),
      });
      const res = await guestLoginPost(req);
      expect(res.status).toBe(200);
    }

    // Zero lockout rows recorded after 10 valid logins
    expect(await prisma.authLockout.count()).toBe(0);

    // 5 failed attempts return HTTP 401
    for (let i = 0; i < 5; i++) {
      const badReq = new NextRequest('http://localhost/api/guest/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': cloudRunXff,
        },
        body: JSON.stringify({ passcode: `wrong-code-${i}` }),
      });
      const badRes = await guestLoginPost(badReq);
      expect(badRes.status).toBe(401);
    }

    // Verify HMAC-SHA256 hashed key is stored in PostgreSQL and raw IP is never stored
    const rows = await prisma.authLockout.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].keyHash).toBe(hashAuthLockoutKey('/api/guest/login:203.0.113.144'));
    expect(rows[0].keyHash).not.toContain('203.0.113.144');
    expect(rows[0].count).toBe(5);

    // 6th attempt from the same IP returns HTTP 429 while a different IP behind the same LB succeeds
    const sixthReq = new NextRequest('http://localhost/api/guest/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': cloudRunXff,
      },
      body: JSON.stringify({ passcode: 'wrong-code-6' }),
    });
    const sixthRes = await guestLoginPost(sixthReq);
    expect(sixthRes.status).toBe(429);

    const otherGuestReq = new NextRequest('http://localhost/api/guest/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '198.51.100.22:60000, 34.107.200.9',
      },
      body: JSON.stringify({ passcode: 'wedding2026' }),
    });
    const otherGuestRes = await guestLoginPost(otherGuestReq);
    expect(otherGuestRes.status).toBe(200);
  });

  test('synchronizes 5 failed attempts across two isolated application instances sharing PostgreSQL on /api/admin/login and /api/guest/login', async () => {
    const sharedPool = getPgPool();
    expect(sharedPool).toBeDefined();

    // Instance A and Instance B maintain completely separate in-memory Maps
    const instanceA = createAuthLockoutInstance({ pool: sharedPool });
    const instanceB = createAuthLockoutInstance({ pool: sharedPool });

    // 1. /api/admin/login: 5 failed attempts on Instance A -> attempt 6 on Instance B returns HTTP 429
    const adminLoginHandler = jest.fn().mockRejectedValue(new ApiError(401, 'Invalid password.'));
    const adminInstanceA = withApiMiddleware(adminLoginHandler, { authInstance: instanceA });
    const adminInstanceB = withApiMiddleware(adminLoginHandler, { authInstance: instanceB });

    const attackerXff = '203.0.113.200, 10.0.0.8';
    for (let i = 0; i < 5; i++) {
      const reqA = new NextRequest('http://localhost/api/admin/login', {
        method: 'POST',
        headers: { 'x-forwarded-for': attackerXff },
      });
      const resA = await adminInstanceA(reqA, {});
      expect(resA.status).toBe(401);
    }

    expect(instanceB.getLocalStoreSize()).toBe(0);

    const reqAdminB6 = new NextRequest('http://localhost/api/admin/login', {
      method: 'POST',
      headers: { 'x-forwarded-for': attackerXff },
    });
    const resAdminB6 = await adminInstanceB(reqAdminB6, {});
    expect(resAdminB6.status).toBe(429);
    // Handler was invoked 5 times on Instance A and 0 times on Instance B
    expect(adminLoginHandler).toHaveBeenCalledTimes(5);

    // 2. /api/guest/login: 5 failed attempts on Instance A -> attempt 6 on Instance B returns HTTP 429
    const guestFailHandler = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: 'Incorrect passcode' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })
    );
    const guestInstanceA = withApiMiddleware(guestFailHandler, { authInstance: instanceA });
    const guestInstanceB = withApiMiddleware(guestFailHandler, { authInstance: instanceB });

    const guestAttackerXff = '198.51.100.201, 10.0.0.9';
    for (let i = 0; i < 5; i++) {
      const reqA = new NextRequest('http://localhost/api/guest/login', {
        method: 'POST',
        headers: { 'x-forwarded-for': guestAttackerXff },
      });
      const resA = await guestInstanceA(reqA, {});
      expect(resA.status).toBe(401);
    }

    const reqGuestB6 = new NextRequest('http://localhost/api/guest/login', {
      method: 'POST',
      headers: { 'x-forwarded-for': guestAttackerXff },
    });
    const resGuestB6 = await guestInstanceB(reqGuestB6, {});
    expect(resGuestB6.status).toBe(429);
    expect(guestFailHandler).toHaveBeenCalledTimes(5);
  });

  test('excludes authLockout rows from DatabaseBackupSchema JSON backups', () => {
    const parsed = DatabaseBackupSchema.parse({
      appConfig: [],
      registryItem: [],
      authLockout: [
        {
          keyHash: hashAuthLockoutKey('/api/admin/login:203.0.113.1'),
          count: 5,
          resetAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });
    expect('authLockout' in parsed).toBe(false);
  });
});
