/** @jest-environment node */

import {
  signGuestInviteSessionToken,
  verifyGuestInviteSessionToken,
} from '../guestInviteSession';

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
