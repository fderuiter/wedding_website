/** @jest-environment node */

import { NextRequest } from 'next/server';
import {
  GUEST_INVITE_COOKIE,
  buildGuestLoginRedirectTarget,
  getGuestInviteSession,
  signGuestInviteSessionToken,
  verifyGuestInviteSessionToken,
} from '../guestInviteSession';
import { prisma } from '@/lib/prisma';
import { env } from '@/env';
import { base64urlEncode, hmacSha256 } from '@/utils/crypto';

describe('guestInviteSession', () => {
  it('signs and verifies a valid guest invite token', async () => {
    const token = await signGuestInviteSessionToken({
      code: 'WEDDING2026',
      guestName: 'Jane Doe',
    });

    expect(typeof token).toBe('string');

    const payload = await verifyGuestInviteSessionToken(token);
    expect(payload).not.toBeNull();
    expect(payload?.code).toBe('WEDDING2026');
    expect(payload?.guestName).toBe('Jane Doe');
  });

  it('rejects tokens signed with the shared guest passcode', async () => {
    const payload = {
      code: 'FORGED2026',
      guestName: 'Impostor Guest',
      iat: Date.now(),
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
    };
    const data = base64urlEncode(JSON.stringify(payload));
    const forgedSignature = await hmacSha256(env.GUEST_PASSCODE, data);
    const forgedToken = `${data}.${forgedSignature}`;

    const verified = await verifyGuestInviteSessionToken(forgedToken);
    expect(verified).toBeNull();
  });

  it('rejects tokens signed with process.env.GUEST_PASSCODE fallback', async () => {
    const passcode = process.env.GUEST_PASSCODE || 'wedding2026';
    const payload = {
      code: 'ATTACKER_CODE',
      guestName: 'Attacker Name',
      iat: Date.now(),
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
    };
    const data = base64urlEncode(JSON.stringify(payload));
    const forgedSignature = await hmacSha256(passcode, data);
    const forgedToken = `${data}.${forgedSignature}`;

    const verified = await verifyGuestInviteSessionToken(forgedToken);
    expect(verified).toBeNull();
  });

  it('throws an error if GUEST_SESSION_SECRET is configured to match GUEST_PASSCODE', async () => {
    const originalSecret = process.env.GUEST_SESSION_SECRET;
    try {
      process.env.GUEST_SESSION_SECRET = env.GUEST_PASSCODE;
      await expect(
        signGuestInviteSessionToken({
          code: 'WEDDING2026',
          guestName: 'Jane Doe',
        })
      ).rejects.toThrow('GUEST_SESSION_SECRET must not use the value of GUEST_PASSCODE');
    } finally {
      if (originalSecret !== undefined) {
        process.env.GUEST_SESSION_SECRET = originalSecret;
      } else {
        delete process.env.GUEST_SESSION_SECRET;
      }
    }
  });

  it('rejects tokens signed with default-guest-session-secret fallback when distinct secret is configured', async () => {
    const payload = {
      code: 'DEFAULT_ATTACK',
      guestName: 'Attacker Default',
      iat: Date.now(),
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
    };
    const data = base64urlEncode(JSON.stringify(payload));
    const forgedSignature = await hmacSha256('default-guest-session-secret', data);
    const forgedToken = `${data}.${forgedSignature}`;

    const originalSecret = process.env.GUEST_SESSION_SECRET;
    try {
      process.env.GUEST_SESSION_SECRET = 'a-secure-production-secret-of-32-chars-or-more';
      const verified = await verifyGuestInviteSessionToken(forgedToken);
      expect(verified).toBeNull();
    } finally {
      if (originalSecret !== undefined) {
        process.env.GUEST_SESSION_SECRET = originalSecret;
      } else {
        delete process.env.GUEST_SESSION_SECRET;
      }
    }
  });

  describe('production environment secret enforcement', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalSecret = process.env.GUEST_SESSION_SECRET;

    beforeEach(() => {
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    });

    afterEach(() => {
      (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
      if (originalSecret !== undefined) {
        process.env.GUEST_SESSION_SECRET = originalSecret;
      } else {
        delete process.env.GUEST_SESSION_SECRET;
      }
    });

    it('throws in production when GUEST_SESSION_SECRET is default-guest-session-secret', async () => {
      process.env.GUEST_SESSION_SECRET = 'default-guest-session-secret';
      await expect(
        signGuestInviteSessionToken({
          code: 'WEDDING2026',
          guestName: 'Jane Doe',
        })
      ).rejects.toThrow('GUEST_SESSION_SECRET must be configured with a distinct secret in production');
    });

    it('throws in production when GUEST_SESSION_SECRET has fewer than 32 characters', async () => {
      process.env.GUEST_SESSION_SECRET = 'short-secret-under-32-chars';
      await expect(
        signGuestInviteSessionToken({
          code: 'WEDDING2026',
          guestName: 'Jane Doe',
        })
      ).rejects.toThrow('GUEST_SESSION_SECRET must be at least 32 characters long in production');
    });

    it('succeeds in production when GUEST_SESSION_SECRET is at least 32 characters', async () => {
      process.env.GUEST_SESSION_SECRET = 'a-valid-production-secret-with-at-least-32-chars';
      const token = await signGuestInviteSessionToken({
        code: 'WEDDING2026',
        guestName: 'Jane Doe',
      });
      expect(typeof token).toBe('string');
      const payload = await verifyGuestInviteSessionToken(token);
      expect(payload?.code).toBe('WEDDING2026');
    });
  });

  it('returns null for an invalid or tampered token', async () => {
    const token = await signGuestInviteSessionToken({
      code: 'WEDDING2026',
      guestName: 'Jane Doe',
    });

    const tampered = token + 'extra';
    const payload = await verifyGuestInviteSessionToken(tampered);
    expect(payload).toBeNull();
  });

  it('returns null for an expired token', async () => {
    const expiredToken = await signGuestInviteSessionToken({
      code: 'WEDDING2026',
      guestName: 'Jane Doe',
      iat: Date.now() - 100000,
      exp: Date.now() - 1000,
    });

    const payload = await verifyGuestInviteSessionToken(expiredToken);
    expect(payload).toBeNull();
  });

  describe('getGuestInviteSession active database record validation', () => {
    const prismaWithInvite = prisma as unknown as {
      invitationCode?: {
        findUnique?: jest.Mock;
        findFirst?: jest.Mock;
      };
    };
    let originalInvitationCode: typeof prismaWithInvite.invitationCode;
    let mockFindUnique: jest.Mock;

    beforeEach(() => {
      originalInvitationCode = prismaWithInvite.invitationCode;
      mockFindUnique = jest.fn();
      prismaWithInvite.invitationCode = {
        findUnique: mockFindUnique,
      };
    });

    afterEach(() => {
      prismaWithInvite.invitationCode = originalInvitationCode;
      delete process.env.STATIC_EXPORT;
    });

    it('returns the session payload when an active non-sample InvitationCode exists', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'inv-active-1',
        code: 'ACTIVE2026',
        guestName: 'Taylor Household',
        isSample: false,
      });

      const token = await signGuestInviteSessionToken({
        code: 'ACTIVE2026',
        guestName: 'Taylor Household',
      });
      const req = new NextRequest('http://localhost/api/photos', {
        headers: { cookie: `${GUEST_INVITE_COOKIE}=${token}` },
      });

      const session = await getGuestInviteSession(req);
      expect(session).toEqual(
        expect.objectContaining({
          code: 'ACTIVE2026',
          guestName: 'Taylor Household',
        })
      );
      expect(mockFindUnique).toHaveBeenCalledWith({
        where: { code: 'ACTIVE2026', isSample: false },
      });
    });

    it('returns null when the invitation record has been deleted', async () => {
      mockFindUnique.mockResolvedValue(null);

      const token = await signGuestInviteSessionToken({
        code: 'DELETED2026',
        guestName: 'Former Guest',
      });
      const req = new NextRequest('http://localhost/api/photos', {
        headers: { cookie: `${GUEST_INVITE_COOKIE}=${token}` },
      });

      const session = await getGuestInviteSession(req);
      expect(session).toBeNull();
    });

    it('returns null when the invitation code has been rotated to a new value', async () => {
      mockFindUnique.mockImplementation(async ({ where }: { where: { code: string; isSample: boolean } }) => {
        if (where.code === 'ROTATEDNEW' && where.isSample === false) {
          return {
            id: 'inv-rot-1',
            code: 'ROTATEDNEW',
            guestName: 'Rotated Guest',
            isSample: false,
          };
        }
        return null;
      });

      const oldToken = await signGuestInviteSessionToken({
        code: 'LEAKEDOLD',
        guestName: 'Rotated Guest',
      });
      const oldReq = new NextRequest('http://localhost/api/photos', {
        headers: { cookie: `${GUEST_INVITE_COOKIE}=${oldToken}` },
      });
      expect(await getGuestInviteSession(oldReq)).toBeNull();

      const newToken = await signGuestInviteSessionToken({
        code: 'ROTATEDNEW',
        guestName: 'Rotated Guest',
      });
      const newReq = new NextRequest('http://localhost/api/photos', {
        headers: { cookie: `${GUEST_INVITE_COOKIE}=${newToken}` },
      });
      expect(await getGuestInviteSession(newReq)).toEqual(
        expect.objectContaining({
          code: 'ROTATEDNEW',
          guestName: 'Rotated Guest',
        })
      );
    });

    it('returns null when the matching invitation record is flagged as sample data', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'inv-sample-1',
        code: 'SMITH2026',
        guestName: 'Sample Guest',
        isSample: true,
      });

      const token = await signGuestInviteSessionToken({
        code: 'SMITH2026',
        guestName: 'Sample Guest',
      });
      const req = new NextRequest('http://localhost/api/photos', {
        headers: { cookie: `${GUEST_INVITE_COOKIE}=${token}` },
      });

      const session = await getGuestInviteSession(req);
      expect(session).toBeNull();
    });

    it('skips database lookups and returns null during STATIC_EXPORT builds', async () => {
      process.env.STATIC_EXPORT = 'true';

      const token = await signGuestInviteSessionToken({
        code: 'ACTIVE2026',
        guestName: 'Taylor Household',
      });
      const req = new NextRequest('http://localhost/api/photos', {
        headers: { cookie: `${GUEST_INVITE_COOKIE}=${token}` },
      });

      const session = await getGuestInviteSession(req);
      expect(session).toBeNull();
      expect(mockFindUnique).not.toHaveBeenCalled();
    });

    it('memoizes verified invitation lookup within the same NextRequest without caching across distinct requests', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'inv-memo-1',
        code: 'MEMO2026',
        guestName: 'Memoized Household',
        isSample: false,
      });

      const token = await signGuestInviteSessionToken({
        code: 'MEMO2026',
        guestName: 'Memoized Household',
      });
      const sameReq = new NextRequest('http://localhost/api/registry/contribute', {
        method: 'POST',
        headers: { cookie: `${GUEST_INVITE_COOKIE}=${token}` },
      });

      const [firstCall, secondCall] = await Promise.all([
        getGuestInviteSession(sameReq),
        getGuestInviteSession(sameReq),
      ]);
      const thirdCall = await getGuestInviteSession(sameReq);

      expect(firstCall?.code).toBe('MEMO2026');
      expect(secondCall?.code).toBe('MEMO2026');
      expect(thirdCall?.code).toBe('MEMO2026');
      expect(mockFindUnique).toHaveBeenCalledTimes(1);

      // Subsequent distinct request re-queries the database and sees revocation immediately
      mockFindUnique.mockResolvedValueOnce(null);
      const nextReq = new NextRequest('http://localhost/api/registry/contribute', {
        method: 'POST',
        headers: { cookie: `${GUEST_INVITE_COOKIE}=${token}` },
      });
      expect(await getGuestInviteSession(nextReq)).toBeNull();
      expect(mockFindUnique).toHaveBeenCalledTimes(2);
    });
  });

  describe('buildGuestLoginRedirectTarget', () => {
    it('preserves valid same-origin relative paths including query strings and hashes', () => {
      expect(buildGuestLoginRedirectTarget('/photos')).toBe('/guest/login?callbackUrl=%2Fphotos');
      expect(buildGuestLoginRedirectTarget('/rsvp?tab=dinner#details')).toBe(
        '/guest/login?callbackUrl=%2Frsvp%3Ftab%3Ddinner%23details'
      );
    });

    it('falls back to /guest/login for control characters, backslashes, protocol-relative URLs, or /guest/login loops', () => {
      expect(buildGuestLoginRedirectTarget(null)).toBe('/guest/login');
      expect(buildGuestLoginRedirectTarget('')).toBe('/guest/login');
      expect(buildGuestLoginRedirectTarget('//evil.test')).toBe('/guest/login');
      expect(buildGuestLoginRedirectTarget('///evil.test')).toBe('/guest/login');
      expect(buildGuestLoginRedirectTarget('/\\evil.test')).toBe('/guest/login');
      expect(buildGuestLoginRedirectTarget('/\t/evil.test')).toBe('/guest/login');
      expect(buildGuestLoginRedirectTarget('/\n/evil.test')).toBe('/guest/login');
      expect(buildGuestLoginRedirectTarget('/\r/evil.test')).toBe('/guest/login');
      expect(buildGuestLoginRedirectTarget('https://evil.test')).toBe('/guest/login');
      expect(buildGuestLoginRedirectTarget('/guest/login')).toBe('/guest/login');
      expect(buildGuestLoginRedirectTarget('/guest/login?callbackUrl=%2Frsvp')).toBe('/guest/login');
      expect(buildGuestLoginRedirectTarget('/guest/login#help')).toBe('/guest/login');
      expect(buildGuestLoginRedirectTarget('/rsvp/../guest/login')).toBe('/guest/login');
    });
  });
});
