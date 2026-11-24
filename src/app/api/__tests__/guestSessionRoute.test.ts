/** @jest-environment node */

import { NextRequest } from 'next/server';
import { GET, DELETE } from '../guest/session/route';
import { getGuestInviteSession, GUEST_INVITE_COOKIE } from '@/core/auth/guestInviteSession';
import { isGuestRequest } from '@/core/auth/guest.server';
import { readRequestCookie } from '@/core/auth/tokenCookieHelpers';

jest.mock('@/core/auth/guestInviteSession', () => ({
  GUEST_INVITE_COOKIE: 'guest_invite_session',
  getGuestInviteSession: jest.fn(),
}));

jest.mock('@/core/auth/guest.server', () => ({
  isGuestRequest: jest.fn(),
}));

jest.mock('@/core/auth/tokenCookieHelpers', () => ({
  readRequestCookie: jest.fn(),
}));

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
});
