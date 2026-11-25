/** @jest-environment node */

import { GET as sessionGetRoute, DELETE as sessionDeleteRoute } from '@/app/api/registry/session/route';
import { signGuestInviteSessionToken, GUEST_INVITE_COOKIE } from '@/core/auth/guestInviteSession';
import { prisma } from '@/lib/prisma';

describe('session Route', () => {
  const prismaWithInvite = prisma as unknown as {
    invitationCode?: {
      findUnique?: jest.Mock;
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
  });

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
        email: null,
      },
    });
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('returns active session details when valid guest_invite_session cookie matches an active invitation', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'inv-1',
      code: 'WEDDING2026',
      guestName: 'Jane Doe',
      isSample: false,
    });

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
        email: null,
      },
    });
  });

  it('returns isVerified: false and expires stale cookie when invitation record was deleted or rotated', async () => {
    mockFindUnique.mockResolvedValue(null);

    const token = await signGuestInviteSessionToken({
      code: 'REVOKEME1',
      guestName: 'Disinvited Guest',
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
        isVerified: false,
        invitationCode: null,
        code: null,
        guestName: null,
        email: null,
      },
    });

    const setCookieHeader = res.headers.get('set-cookie') || '';
    expect(setCookieHeader).toContain(`${GUEST_INVITE_COOKIE}=`);
    expect(setCookieHeader).toContain('Max-Age=0');
  });

  it('returns isVerified: false and expires cookie when invitation record is flagged as sample', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'inv-sample',
      code: 'SMITH2026',
      guestName: 'Sample Household',
      isSample: true,
    });

    const token = await signGuestInviteSessionToken({
      code: 'SMITH2026',
      guestName: 'Sample Household',
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
    expect(json.data.isVerified).toBe(false);

    const setCookieHeader = res.headers.get('set-cookie') || '';
    expect(setCookieHeader).toContain(`${GUEST_INVITE_COOKIE}=`);
    expect(setCookieHeader).toContain('Max-Age=0');
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

    const setCookieHeader = res.headers.get('set-cookie') || '';
    expect(setCookieHeader).toContain(`${GUEST_INVITE_COOKIE}=`);
    expect(setCookieHeader).toContain('Max-Age=0');
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

  it('hydrates saved household postal fields on active guest_invite_session and never leaks data for shared guest_auth cookie', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'inv-postal-1',
      code: 'POSTAL2026',
      guestName: 'Alex & Sam Rivera',
      householdName: 'The Rivera Household',
      email: 'rivera@example.com',
      addressLine1: '742 Evergreen Terrace',
      addressLine2: 'Apt 4B',
      city: 'Springfield',
      state: 'IL',
      zipCode: '62704',
      country: 'United States',
      isSample: false,
    });

    const inviteToken = await signGuestInviteSessionToken({
      code: 'POSTAL2026',
      guestName: 'Alex & Sam Rivera',
    });

    const verifiedReq = new Request('http://localhost/api/registry/session', {
      method: 'GET',
      headers: {
        cookie: `${GUEST_INVITE_COOKIE}=${inviteToken}`,
      },
    });
    const verifiedRes = await sessionGetRoute(verifiedReq as any);
    expect(verifiedRes.status).toBe(200);
    const verifiedJson = await verifiedRes.json();
    expect(verifiedJson).toEqual({
      success: true,
      data: {
        isVerified: true,
        invitationCode: 'POSTAL2026',
        code: 'POSTAL2026',
        guestName: 'Alex & Sam Rivera',
        householdName: 'The Rivera Household',
        email: 'rivera@example.com',
        addressLine1: '742 Evergreen Terrace',
        addressLine2: 'Apt 4B',
        city: 'Springfield',
        state: 'IL',
        zipCode: '62704',
        country: 'United States',
      },
    });

    // Shared-passcode guest_auth cookie without guest_invite_session must never receive household postal data
    const sharedPasscodeReq = new Request('http://localhost/api/registry/session', {
      method: 'GET',
      headers: {
        cookie: 'guest_auth=shared-passcode-token',
      },
    });
    const sharedPasscodeRes = await sessionGetRoute(sharedPasscodeReq as any);
    expect(sharedPasscodeRes.status).toBe(200);
    const sharedPasscodeJson = await sharedPasscodeRes.json();
    expect(sharedPasscodeJson).toEqual({
      success: true,
      data: {
        isVerified: false,
        invitationCode: null,
        code: null,
        guestName: null,
        email: null,
      },
    });
  });
});
