/** @jest-environment node */

import { GET as sessionGetRoute, DELETE as sessionDeleteRoute } from '@/app/api/registry/session/route';
import { signGuestInviteSessionToken, GUEST_INVITE_COOKIE } from '@/core/auth/guestInviteSession';

describe('session Route', () => {
  it('returns isVerified: false when no session cookie is present', async () => {
    const req = new Request('http://localhost/api/registry/session', {
      method: 'GET',
    });
    const res = await sessionGetRoute(req as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      success: true,
      data: {
        isVerified: false,
        invitationCode: null,
        code: null,
        guestName: null,
      },
    });
  });

  it('returns active session details when valid guest_invite_session cookie is present', async () => {
    const token = await signGuestInviteSessionToken({
      code: 'WEDDING2026',
      guestName: 'Jane Doe',
    });

    const req = new Request('http://localhost/api/registry/session', {
      method: 'GET',
      headers: {
        cookie: `${GUEST_INVITE_COOKIE}=${token}`,
      },
    });

    const res = await sessionGetRoute(req as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      success: true,
      data: {
        isVerified: true,
        invitationCode: 'WEDDING2026',
        code: 'WEDDING2026',
        guestName: 'Jane Doe',
      },
    });
  });

  it('returns isVerified: false when invalid/tampered cookie is provided', async () => {
    const req = new Request('http://localhost/api/registry/session', {
      method: 'GET',
      headers: {
        cookie: `${GUEST_INVITE_COOKIE}=invalid.token.value`,
      },
    });

    const res = await sessionGetRoute(req as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.isVerified).toBe(false);
  });

  it('clears session cookie on DELETE request', async () => {
    const req = new Request('http://localhost/api/registry/session', {
      method: 'DELETE',
    });

    const res = await sessionDeleteRoute(req as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.isVerified).toBe(false);

    const setCookieHeader = res.headers.get('set-cookie') || '';
    expect(setCookieHeader).toContain(`${GUEST_INVITE_COOKIE}=`);
    expect(setCookieHeader).toContain('Max-Age=0');
  });
});
