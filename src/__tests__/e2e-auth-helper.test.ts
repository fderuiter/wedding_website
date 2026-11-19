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

  it('signs guest_invite_session tokens with GUEST_SESSION_SECRET accepted by getGuestInviteSession', async () => {
    process.env.GUEST_PASSCODE = 'wedding2026';
    process.env.GUEST_SESSION_SECRET = 'playwright-e2e-session-secret-32-chars-min';

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
  });

  it('rejects GUEST_SESSION_SECRET values that match GUEST_PASSCODE', () => {
    process.env.GUEST_PASSCODE = 'shared-passcode-value';
    process.env.GUEST_SESSION_SECRET = 'shared-passcode-value';

    expect(() => generateGuestCookieValue()).toThrow(
      'GUEST_SESSION_SECRET must not use the value of GUEST_PASSCODE'
    );
  });

  it('signs admin_auth tokens with ADMIN_PASSWORD accepted by isAdminRequest', async () => {
    process.env.ADMIN_PASSWORD = 'scrypt:c2FsdA==:aGFzaA==';

    const token = generateAdminCookieValue();
    const accepted = await isAdminRequest({
      cookies: {
        get: (name: string) => (name === ADMIN_COOKIE ? { value: token } : undefined),
      },
      headers: new Headers(),
    } as never);

    expect(accepted).toBe(true);
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
