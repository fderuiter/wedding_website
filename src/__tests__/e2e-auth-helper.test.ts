/** @jest-environment node */

import type { BrowserContext } from '@playwright/test';
import {
  generateAdminCookieValue,
  generateGuestCookieValue,
  generateGuestInviteSessionCookieValue,
  seedAdminAndGuestAuthCookies,
  seedGuestAuthCookies,
} from '../../e2e/helpers/auth';
import { GUEST_COOKIE, isGuestRequest } from '@/core/auth/guest.server';
import { GUEST_INVITE_COOKIE, getGuestInviteSession } from '@/core/auth/guestInviteSession';
import { ADMIN_COOKIE, isAdminRequest } from '@/core/auth/auth.server';
import { prisma } from '@/lib/prisma';
import { base64urlEncode, hmacSha256 } from '@/utils/crypto';

describe('E2E Auth Helpers (e2e/helpers/auth.ts)', () => {
  const originalGuestSecret = process.env.GUEST_SESSION_SECRET;
  const originalGuestPasscode = process.env.GUEST_PASSCODE;
  const originalAdminPassword = process.env.ADMIN_PASSWORD;

  afterEach(() => {
    if (originalGuestSecret !== undefined) {
      process.env.GUEST_SESSION_SECRET = originalGuestSecret;
    } else {
      delete process.env.GUEST_SESSION_SECRET;
    }

    if (originalGuestPasscode !== undefined) {
      process.env.GUEST_PASSCODE = originalGuestPasscode;
    } else {
      delete process.env.GUEST_PASSCODE;
    }

    if (originalAdminPassword !== undefined) {
      process.env.ADMIN_PASSWORD = originalAdminPassword;
    } else {
      delete process.env.ADMIN_PASSWORD;
    }
  });

  it('signs guest_auth tokens with GUEST_SESSION_SECRET accepted by isGuestRequest', async () => {
    process.env.GUEST_PASSCODE = 'wedding2026';
    process.env.GUEST_SESSION_SECRET = 'playwright-e2e-session-secret-32-chars-min';

    const token = generateGuestCookieValue();
    const accepted = await isGuestRequest({
      cookies: {
        get: (name: string) => (name === GUEST_COOKIE ? { value: token } : undefined),
      },
      headers: new Headers(),
    } as never);

    expect(accepted).toBe(true);
  });

  it('signs guest_invite_session tokens with GUEST_SESSION_SECRET accepted by getGuestInviteSession when active in DB', async () => {
    process.env.GUEST_PASSCODE = 'wedding2026';
    process.env.GUEST_SESSION_SECRET = 'playwright-e2e-session-secret-32-chars-min';

    const prismaWithInvite = prisma as unknown as {
      invitationCode?: { findUnique?: jest.Mock };
    };
    const originalInvitationCode = prismaWithInvite.invitationCode;
    const mockFindUnique = jest.fn().mockResolvedValue({
      id: 'inv-vip-100',
      code: 'VIP100',
      guestName: 'Alice',
      isSample: false,
    });
    prismaWithInvite.invitationCode = { findUnique: mockFindUnique };

    try {
      const token = generateGuestInviteSessionCookieValue('VIP100', 'Alice');
      const session = await getGuestInviteSession({
        cookies: {
          get: (name: string) => (name === GUEST_INVITE_COOKIE ? { value: token } : undefined),
        },
        headers: new Headers(),
      } as never);

      expect(session).toEqual(
        expect.objectContaining({
          code: 'VIP100',
          guestName: 'Alice',
        })
      );

      mockFindUnique.mockResolvedValueOnce(null);
      const revokedSession = await getGuestInviteSession({
        cookies: {
          get: (name: string) => (name === GUEST_INVITE_COOKIE ? { value: token } : undefined),
        },
        headers: new Headers(),
      } as never);
      expect(revokedSession).toBeNull();
    } finally {
      prismaWithInvite.invitationCode = originalInvitationCode;
    }
  });

  it('rejects GUEST_SESSION_SECRET values that match GUEST_PASSCODE', () => {
    process.env.GUEST_PASSCODE = 'shared-passcode-value';
    process.env.GUEST_SESSION_SECRET = 'shared-passcode-value';

    expect(() => generateGuestCookieValue()).toThrow(
      'GUEST_SESSION_SECRET must not use the value of GUEST_PASSCODE'
    );
  });

  it('signs admin_auth tokens with domain-separated key from 64-byte scrypt ADMIN_PASSWORD and rejects raw ADMIN_PASSWORD signatures', async () => {
    process.env.ADMIN_PASSWORD =
      'scrypt:d2VkZGluZy1lMmUtc2FsdA==:q++ok9TyDBa8bSKUlVR+j/tjiVTGj95CWT5HK8KkpIHzWRnv2t2hAhDz2PkdPUDsMO+ulGpXGCFQAqDKwK7Lxw==';

    const token = generateAdminCookieValue();
    const accepted = await isAdminRequest({
      cookies: {
        get: (name: string) => (name === ADMIN_COOKIE ? { value: token } : undefined),
      },
      headers: new Headers(),
    } as never);

    expect(accepted).toBe(true);

    const encodedPayload = base64urlEncode(JSON.stringify({ isAdmin: true, iat: Date.now() }));
    const rawSignedToken = `${encodedPayload}.${await hmacSha256(process.env.ADMIN_PASSWORD, encodedPayload)}`;
    const rawAccepted = await isAdminRequest({
      cookies: {
        get: (name: string) => (name === ADMIN_COOKIE ? { value: rawSignedToken } : undefined),
      },
      headers: new Headers(),
    } as never);

    expect(rawAccepted).toBe(false);
  });

  it('seeds guest and admin cookies onto both 127.0.0.1 and localhost origins', async () => {
    const addCookies = jest.fn().mockResolvedValue(undefined);
    const mockContext = { addCookies } as unknown as BrowserContext;

    await seedGuestAuthCookies(mockContext);
    expect(addCookies).toHaveBeenCalledTimes(1);
    expect(addCookies.mock.calls[0][0]).toEqual([
      expect.objectContaining({ name: 'guest_auth', url: 'http://127.0.0.1:3000' }),
      expect.objectContaining({ name: 'guest_auth', url: 'http://localhost:3000' }),
    ]);

    addCookies.mockClear();
    await seedAdminAndGuestAuthCookies(mockContext);
    expect(addCookies).toHaveBeenCalledTimes(1);
    expect(addCookies.mock.calls[0][0]).toEqual([
      expect.objectContaining({ name: 'admin_auth', url: 'http://127.0.0.1:3000' }),
      expect.objectContaining({ name: 'guest_auth', url: 'http://127.0.0.1:3000' }),
      expect.objectContaining({ name: 'admin_auth', url: 'http://localhost:3000' }),
      expect.objectContaining({ name: 'guest_auth', url: 'http://localhost:3000' }),
    ]);
  });
});
