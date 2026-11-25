/** @jest-environment node */

import { NextRequest } from 'next/server';
import { GET, DELETE } from '../guest/session/route';
import { getGuestInviteSession, GUEST_INVITE_COOKIE } from '@/core/auth/guestInviteSession';
import { isGuestRequest } from '@/core/auth/guest.server';
import { readRequestCookie } from '@/core/auth/tokenCookieHelpers';

jest.mock('@/core/auth/guestInviteSession', () => {
  const actualInviteToken = jest.requireActual('@/core/auth/guestInviteToken');
  return {
    GUEST_INVITE_COOKIE: 'guest_invite_session',
    clearGuestInviteSessionCookie: actualInviteToken.clearGuestInviteSessionCookie,
    getGuestInviteSession: jest.fn(),
  };
});

jest.mock('@/core/auth/guest.server', () => ({
  isGuestRequest: jest.fn(),
}));

jest.mock('@/core/auth/tokenCookieHelpers', () => {
  const actual = jest.requireActual('@/core/auth/tokenCookieHelpers');
  return {
    ...actual,
    readRequestCookie: jest.fn(),
  };
});

describe('/api/guest/session Route', () => {
  const mockGetGuestInviteSession = getGuestInviteSession as jest.MockedFunction<
    typeof getGuestInviteSession
  >;
  const mockIsGuestRequest = isGuestRequest as jest.MockedFunction<typeof isGuestRequest>;
  const mockReadRequestCookie = readRequestCookie as jest.MockedFunction<typeof readRequestCookie>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns status: invitation with household metadata when valid invite session exists', async () => {
    mockReadRequestCookie.mockResolvedValue('signed-invite-token');
    mockGetGuestInviteSession.mockResolvedValue({
      code: 'DARCY2026',
      guestName: 'Fitzwilliam Darcy',
    });
    mockIsGuestRequest.mockResolvedValue(true);

    const req = new NextRequest('http://localhost:3000/api/guest/session');
    const res = await GET(req, {});
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('Vary')).toBe('Cookie');
    expect(body.success).toBe(true);
    expect(body.data).toEqual({
      status: 'invitation',
      isVerified: true,
      invitationCode: 'DARCY2026',
      code: 'DARCY2026',
      guestName: 'Fitzwilliam Darcy',
      hasPasscodeSession: true,
    });
  });

  it('clears stale/revoked guest_invite_session cookie while preserving guest_auth passcode status', async () => {
    mockReadRequestCookie.mockResolvedValue('stale-or-revoked-token');
    mockGetGuestInviteSession.mockResolvedValue(null);
    mockIsGuestRequest.mockResolvedValue(true);

    const req = new NextRequest('http://localhost:3000/api/guest/session', {
      headers: {
        cookie: 'guest_auth=valid-passcode-jwt; guest_invite_session=stale-or-revoked-token',
      },
    });
    const res = await GET(req, {});
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual({
      status: 'passcode',
      isVerified: false,
      invitationCode: null,
      code: null,
      guestName: null,
      hasPasscodeSession: true,
    });
    const clearedCookie = res.cookies.get(GUEST_INVITE_COOKIE);
    expect(clearedCookie?.value).toBe('');
    expect(res.cookies.get('guest_auth')).toBeUndefined();
  });

  it('returns status: none when neither invite nor passcode session exists', async () => {
    mockReadRequestCookie.mockResolvedValue(undefined);
    mockGetGuestInviteSession.mockResolvedValue(null);
    mockIsGuestRequest.mockResolvedValue(false);

    const req = new NextRequest('http://localhost:3000/api/guest/session');
    const res = await GET(req, {});
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual({
      status: 'none',
      isVerified: false,
      invitationCode: null,
      code: null,
      guestName: null,
      hasPasscodeSession: false,
    });
  });

  it('clears guest_invite_session on DELETE while preserving guest_auth passcode status', async () => {
    mockIsGuestRequest.mockResolvedValue(true);

    const req = new NextRequest('http://localhost:3000/api/guest/session', {
      method: 'DELETE',
      headers: {
        cookie: 'guest_auth=valid-passcode-jwt; guest_invite_session=active-invite-token',
      },
    });
    const res = await DELETE(req, {});
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('Vary')).toBe('Cookie');
    expect(body.success).toBe(true);
    expect(body.data).toEqual({
      status: 'passcode',
      isVerified: false,
      invitationCode: null,
      code: null,
      guestName: null,
      hasPasscodeSession: true,
    });
    expect(res.cookies.get(GUEST_INVITE_COOKIE)?.value).toBe('');
    expect(res.cookies.get('guest_auth')).toBeUndefined();
  });

  it('clears __Host-guest_invite_session over HTTPS in production and blocks cross-site DELETE with 403', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    try {
      mockIsGuestRequest.mockResolvedValue(true);

      const crossSiteRes = await DELETE(
        new NextRequest('https://wedding.example/api/guest/session', {
          method: 'DELETE',
          headers: {
            host: 'wedding.example',
            'x-forwarded-proto': 'https',
            'sec-fetch-site': 'cross-site',
          },
        }),
        {}
      );
      expect(crossSiteRes.status).toBe(403);

      const sameOriginRes = await DELETE(
        new NextRequest('https://wedding.example/api/guest/session', {
          method: 'DELETE',
          headers: {
            host: 'wedding.example',
            origin: 'https://wedding.example',
            'x-forwarded-proto': 'https',
            'sec-fetch-site': 'same-origin',
            cookie:
              '__Host-guest_auth=valid-passcode-jwt; __Host-guest_invite_session=active-invite-token; guest_invite_session=legacy-token',
          },
        }),
        {}
      );
      expect(sameOriginRes.status).toBe(200);
      expect(sameOriginRes.cookies.get('__Host-guest_invite_session')?.value).toBe('');
      expect(sameOriginRes.cookies.get(GUEST_INVITE_COOKIE)?.value).toBe('');
      expect(sameOriginRes.cookies.get('__Host-guest_auth')).toBeUndefined();
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = prevNodeEnv;
    }
  });

  it('clears guest_auth, guest_invite_session, and guest_photo_session (including __Host- variants) when scope=all is requested', async () => {
    mockIsGuestRequest.mockResolvedValue(true);

    const localFullSignOutRes = await DELETE(
      new NextRequest('http://localhost:3000/api/guest/session?scope=all', {
        method: 'DELETE',
        headers: {
          cookie:
            'guest_auth=valid-passcode-jwt; guest_invite_session=active-invite-token; guest_photo_session=active-photo-token',
        },
      }),
      {}
    );
    const localBody = await localFullSignOutRes.json();

    expect(localFullSignOutRes.status).toBe(200);
    expect(localBody.data).toEqual({
      status: 'none',
      isVerified: false,
      invitationCode: null,
      code: null,
      guestName: null,
      hasPasscodeSession: false,
    });
    expect(localFullSignOutRes.cookies.get('guest_auth')?.value).toBe('');
    expect(localFullSignOutRes.cookies.get(GUEST_INVITE_COOKIE)?.value).toBe('');
    expect(localFullSignOutRes.cookies.get('guest_photo_session')?.value).toBe('');

    const prevNodeEnv = process.env.NODE_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    try {
      const httpsFullSignOutRes = await DELETE(
        new NextRequest('https://wedding.example/api/guest/session?scope=all', {
          method: 'DELETE',
          headers: {
            host: 'wedding.example',
            origin: 'https://wedding.example',
            'x-forwarded-proto': 'https',
            'sec-fetch-site': 'same-origin',
            cookie:
              '__Host-guest_auth=valid-passcode-jwt; guest_auth=legacy-passcode; __Host-guest_invite_session=active-invite-token; guest_invite_session=legacy-invite; __Host-guest_photo_session=active-photo-token; guest_photo_session=legacy-photo',
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
  });
});
