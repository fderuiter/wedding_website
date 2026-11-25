/** @jest-environment node */

import { NextRequest } from 'next/server';
import { DELETE as deleteGuestSession } from '@/app/api/guest/session/route';
import {
  GUEST_COOKIE,
  isGuestRequest,
  signGuestToken,
  verifyGuestToken,
} from '@/core/auth/guest.server';
import { GUEST_INVITE_COOKIE } from '@/core/auth/guestInviteSession';
import { GUEST_PHOTO_COOKIE } from '@/core/auth/photoUploadToken';
import { signCompactToken } from '@/core/auth/tokenCookieHelpers';
import {
  GUEST_PASSCODE_DIGEST_DOMAIN,
  computeGuestPasscodeDigest,
  isValidTokenEpochVersion,
  normalizeTokenEpochVersion,
  verifyGuestPasscodeDigest,
} from '@/core/auth/tokenEpochs';
import { createStaticDemoRouter } from '@/lib/staticDemo/router';
import { createDemoStore } from '@/lib/staticDemo/store';
import { hmacSha256 } from '@/utils/crypto';
import { resetRateLimitsForTesting } from '@/utils/rateLimit';

describe('Guest Passcode Digest & Scoped Guest Session Sign-Out', () => {
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    await resetRateLimitsForTesting();
    process.env = {
      ...originalEnv,
      GUEST_SESSION_SECRET: 'guest-passcode-digest-test-secret-32chars!!',
      GUEST_PASSCODE: 'initial-passcode-2026',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('validates positive integer token epoch versions and constant-time passcode digests via tokenEpochs helpers', async () => {
    expect(isValidTokenEpochVersion(1)).toBe(true);
    expect(isValidTokenEpochVersion(5)).toBe(true);
    expect(isValidTokenEpochVersion(0)).toBe(false);
    expect(isValidTokenEpochVersion(-1)).toBe(false);
    expect(isValidTokenEpochVersion(1.5)).toBe(false);
    expect(isValidTokenEpochVersion('1')).toBe(false);

    expect(normalizeTokenEpochVersion(undefined)).toBe(1);
    expect(normalizeTokenEpochVersion(null)).toBe(1);
    expect(normalizeTokenEpochVersion(0)).toBe(1);
    expect(normalizeTokenEpochVersion(4)).toBe(4);

    const secret = process.env.GUEST_SESSION_SECRET!;
    const digest = await computeGuestPasscodeDigest(secret, 'alpha-passcode');
    await expect(verifyGuestPasscodeDigest(digest, secret, 'alpha-passcode')).resolves.toBe(true);
    await expect(verifyGuestPasscodeDigest(digest, secret, 'beta-passcode')).resolves.toBe(false);
    await expect(verifyGuestPasscodeDigest('', secret, 'alpha-passcode')).resolves.toBe(false);
    await expect(verifyGuestPasscodeDigest(null, secret, 'alpha-passcode')).resolves.toBe(false);
  });

  it('stamps domain-separated HMAC-SHA256 passcode digest and invalidates prior guest_auth tokens when GUEST_PASSCODE rotates without rotating GUEST_SESSION_SECRET', async () => {
    const tokenBeforeRotation = await signGuestToken({
      guest: true,
      iat: Date.now(),
      exp: Date.now() + 60_000,
    });

    const verifiedBefore = await verifyGuestToken(tokenBeforeRotation);
    expect(verifiedBefore).toEqual(
      expect.objectContaining({
        guest: true,
        pwd: expect.any(String),
      })
    );

    const expectedDomainDigest = await hmacSha256(
      `${GUEST_PASSCODE_DIGEST_DOMAIN}:${process.env.GUEST_SESSION_SECRET}`,
      'initial-passcode-2026'
    );
    const rawUndomainedDigest = await hmacSha256(
      process.env.GUEST_SESSION_SECRET!,
      'initial-passcode-2026'
    );
    expect(verifiedBefore?.pwd).toBe(expectedDomainDigest);
    expect(verifiedBefore?.pwd).not.toBe(rawUndomainedDigest);

    const makeGuestReq = (cookieToken: string) =>
      new NextRequest('http://localhost:3000/photos', {
        headers: {
          host: 'localhost:3000',
          cookie: `${GUEST_COOKIE}=${cookieToken}`,
        },
      });

    await expect(isGuestRequest(makeGuestReq(tokenBeforeRotation))).resolves.toBe(true);
    await expect(
      isGuestRequest(makeGuestReq(tokenBeforeRotation), { edgeOnly: true })
    ).resolves.toBe(true);

    // Rotate GUEST_PASSCODE while keeping GUEST_SESSION_SECRET unchanged
    process.env.GUEST_PASSCODE = 'rotated-passcode-2027';

    await expect(verifyGuestToken(tokenBeforeRotation)).resolves.toBeNull();
    await expect(isGuestRequest(makeGuestReq(tokenBeforeRotation))).resolves.toBe(false);
    await expect(
      isGuestRequest(makeGuestReq(tokenBeforeRotation), { edgeOnly: true })
    ).resolves.toBe(false);

    // Newly issued token under rotated passcode is accepted
    const tokenAfterRotation = await signGuestToken({
      guest: true,
      iat: Date.now(),
      exp: Date.now() + 60_000,
    });
    await expect(verifyGuestToken(tokenAfterRotation)).resolves.toEqual(
      expect.objectContaining({ guest: true })
    );
    await expect(isGuestRequest(makeGuestReq(tokenAfterRotation))).resolves.toBe(true);
    await expect(
      isGuestRequest(makeGuestReq(tokenAfterRotation), { edgeOnly: true })
    ).resolves.toBe(true);
  });

  it('rejects validly signed compact guest tokens missing pwd or carrying a forged digest', async () => {
    const secret = process.env.GUEST_SESSION_SECRET!;

    const missingPwdToken = await signCompactToken(
      { guest: true, iat: Date.now(), exp: Date.now() + 60_000 },
      secret
    );
    await expect(verifyGuestToken(missingPwdToken)).resolves.toBeNull();

    const wrongDomainDigest = await hmacSha256(secret, process.env.GUEST_PASSCODE!);
    const forgedPwdToken = await signCompactToken(
      {
        guest: true,
        pwd: wrongDomainDigest,
        iat: Date.now(),
        exp: Date.now() + 60_000,
      },
      secret
    );
    await expect(verifyGuestToken(forgedPwdToken)).resolves.toBeNull();
  });

  it('preserves guest_auth on default DELETE /api/guest/session and clears guest_auth, guest_invite_session, and guest_photo_session (plus __Host- variants and staticDemo sessions) when scope=all is requested', async () => {
    const validGuestToken = await signGuestToken({
      guest: true,
      iat: Date.now(),
      exp: Date.now() + 60_000,
    });

    // 1. Default household switch preserves guest_auth
    const defaultDeleteRes = await deleteGuestSession(
      new NextRequest('http://localhost:3000/api/guest/session', {
        method: 'DELETE',
        headers: {
          host: 'localhost:3000',
          origin: 'http://localhost:3000',
          cookie: `${GUEST_COOKIE}=${validGuestToken}; ${GUEST_INVITE_COOKIE}=invite-token`,
        },
      }),
      {}
    );
    expect(defaultDeleteRes.status).toBe(200);
    expect((await defaultDeleteRes.json()).data).toEqual({
      status: 'passcode',
      isVerified: false,
      invitationCode: null,
      code: null,
      guestName: null,
      hasPasscodeSession: true,
    });
    expect(defaultDeleteRes.cookies.get(GUEST_COOKIE)).toBeUndefined();
    expect(defaultDeleteRes.cookies.get(GUEST_INVITE_COOKIE)?.value).toBe('');

    // 2. Full sign-out (?scope=all) clears all guest cookies locally and over HTTPS (__Host-)
    const localFullSignOutRes = await deleteGuestSession(
      new NextRequest('http://localhost:3000/api/guest/session?scope=all', {
        method: 'DELETE',
        headers: {
          host: 'localhost:3000',
          origin: 'http://localhost:3000',
          cookie: `${GUEST_COOKIE}=${validGuestToken}; ${GUEST_INVITE_COOKIE}=invite-token; ${GUEST_PHOTO_COOKIE}=photo-token`,
        },
      }),
      {}
    );
    expect(localFullSignOutRes.status).toBe(200);
    expect((await localFullSignOutRes.json()).data).toEqual({
      status: 'none',
      isVerified: false,
      invitationCode: null,
      code: null,
      guestName: null,
      hasPasscodeSession: false,
    });
    expect(localFullSignOutRes.cookies.get(GUEST_COOKIE)?.value).toBe('');
    expect(localFullSignOutRes.cookies.get(GUEST_INVITE_COOKIE)?.value).toBe('');
    expect(localFullSignOutRes.cookies.get(GUEST_PHOTO_COOKIE)?.value).toBe('');

    const prevNodeEnv = process.env.NODE_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    try {
      const httpsFullSignOutRes = await deleteGuestSession(
        new NextRequest('https://wedding.example/api/guest/session?scope=all', {
          method: 'DELETE',
          headers: {
            host: 'wedding.example',
            origin: 'https://wedding.example',
            'x-forwarded-proto': 'https',
            'sec-fetch-site': 'same-origin',
            cookie: `__Host-guest_auth=${validGuestToken}; guest_auth=legacy-passcode; __Host-guest_invite_session=active-invite; guest_invite_session=legacy-invite; __Host-guest_photo_session=active-photo; guest_photo_session=legacy-photo`,
          },
        }),
        {}
      );
      expect(httpsFullSignOutRes.status).toBe(200);
      expect(httpsFullSignOutRes.cookies.get('__Host-guest_auth')?.value).toBe('');
      expect(httpsFullSignOutRes.cookies.get('guest_auth')?.value).toBe('');
      expect(httpsFullSignOutRes.cookies.get('__Host-guest_invite_session')?.value).toBe('');
      expect(httpsFullSignOutRes.cookies.get(GUEST_INVITE_COOKIE)?.value).toBe('');
      expect(httpsFullSignOutRes.cookies.get('__Host-guest_photo_session')?.value).toBe('');
      expect(httpsFullSignOutRes.cookies.get('guest_photo_session')?.value).toBe('');
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = prevNodeEnv;
    }

    // 3. Static showcase router honors scope=all on passcode sessions
    const demoStore = createDemoStore({
      storage: null,
      syncAdminLocalStorage: false,
    });
    const demoRouter = createStaticDemoRouter({ store: demoStore });
    demoStore.mutate((draft) => {
      draft.guestSession = {
        code: '',
        guestName: 'Shared Passcode Guest',
        sessionType: 'guest',
      };
    });

    const demoDefaultDelete = await demoRouter('http://localhost:3000/api/guest/session', {
      method: 'DELETE',
    });
    expect((await demoDefaultDelete!.json()).data.hasPasscodeSession).toBe(true);

    const demoFullDelete = await demoRouter('http://localhost:3000/api/guest/session?scope=all', {
      method: 'DELETE',
    });
    expect((await demoFullDelete!.json()).data).toMatchObject({
      status: 'none',
      hasPasscodeSession: false,
    });
  });
});
