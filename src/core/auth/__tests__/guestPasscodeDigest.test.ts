/** @jest-environment node */

import { NextRequest } from 'next/server';
import {
  GUEST_COOKIE,
  isGuestRequest,
  signGuestToken,
  verifyGuestToken,
} from '@/core/auth/guest.server';
import { signCompactToken } from '@/core/auth/tokenCookieHelpers';
import { hmacSha256 } from '@/utils/crypto';

describe('Guest Passcode Digest Claim (src/core/auth/guest.server.ts)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      GUEST_SESSION_SECRET: 'guest-passcode-digest-test-secret-32chars!!',
      GUEST_PASSCODE: 'initial-passcode-2026',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
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
      `wedding-website:guest-passcode-digest:v1:${process.env.GUEST_SESSION_SECRET}`,
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
});
