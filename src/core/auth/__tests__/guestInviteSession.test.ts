/** @jest-environment node */

import {
  signGuestInviteSessionToken,
  verifyGuestInviteSessionToken,
} from '../guestInviteSession';
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
      process.env.NODE_ENV = 'production';
    });

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
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
});
