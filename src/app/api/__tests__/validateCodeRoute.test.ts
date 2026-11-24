/** @jest-environment node */

jest.mock('@/lib/prisma', () => ({
  prisma: {
    invitationCode: {
      findUnique: jest.fn(),
    },
  },
}));

import { GET as validateCodeRoute } from '@/app/api/registry/validate-code/route';
import { GET as registrySessionGet } from '@/app/api/registry/session/route';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyGuestInviteSessionToken } from '@/core/auth/guestInviteSession';

const mockFindUnique = prisma.invitationCode.findUnique as jest.Mock;

describe('validate-code Route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 if code parameter is missing', async () => {
    const req = new Request('http://localhost/api/registry/validate-code', {
      method: 'GET',
    });
    const res = await validateCodeRoute(req as any);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Code is required.');
  });

  it('returns 404 if invitation code is not found', async () => {
    mockFindUnique.mockResolvedValue(null);
    const req = new Request('http://localhost/api/registry/validate-code?code=INVALID1', {
      method: 'GET',
    });
    const res = await validateCodeRoute(req as any);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Invalid invitation code.');
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { code: 'INVALID1' },
    });
  });

  it('returns 404 and sets no guest_invite_session cookie for a sample invitation code', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'sample-invite-1',
      code: 'SMITH2026',
      guestName: 'Mr. & Mrs. Robert Smith',
      used: false,
      isSample: true,
    });
    const req = new Request('http://localhost/api/registry/validate-code?code=smith2026', {
      method: 'GET',
    });
    const res = await validateCodeRoute(req as any);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Invalid invitation code.');
    expect(res.headers.get('set-cookie') || '').not.toContain('guest_invite_session=');
  });

  it('returns 200 with guestName and valid: true for a previously used invitation code', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'invite-123',
      code: 'USEDCODE',
      guestName: 'John Doe',
      email: null,
      used: true,
    });
    const req = new Request('http://localhost/api/registry/validate-code?code=USEDCODE', {
      method: 'GET',
    });
    const res = await validateCodeRoute(req as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      success: true,
      data: {
        valid: true,
        guestName: 'John Doe',
        code: 'USEDCODE',
        email: null,
      }
    });
  });

  it('returns 200 with guestName, invite email, and valid: true for an active code and hydrates email in /api/registry/session', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'invite-123',
      code: 'GOODCODE',
      guestName: 'Jane Smith',
      email: 'jane.smith@example.com',
      used: false,
      isSample: false,
    });
    const req = new Request('http://localhost/api/registry/validate-code?code=GOODCODE', {
      method: 'GET',
    });
    const res = await validateCodeRoute(req as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      success: true,
      data: {
        valid: true,
        guestName: 'Jane Smith',
        code: 'GOODCODE',
        email: 'jane.smith@example.com',
      }
    });

    const setCookieHeader = res.headers.get('set-cookie') || '';
    expect(setCookieHeader).toContain('guest_invite_session=');

    const cookieMatch = setCookieHeader.match(/guest_invite_session=([^;]+)/);
    expect(cookieMatch).not.toBeNull();
    const token = cookieMatch![1];
    const verified = await verifyGuestInviteSessionToken(token);
    expect(verified).not.toBeNull();
    expect(verified?.code).toBe('GOODCODE');
    expect(verified?.guestName).toBe('Jane Smith');

    const sessionRes = await registrySessionGet(
      new NextRequest('http://localhost/api/registry/session', {
        headers: { cookie: `guest_invite_session=${token}` },
      })
    );
    expect(sessionRes.status).toBe(200);
    const sessionJson = await sessionRes.json();
    expect(sessionJson.data).toEqual({
      isVerified: true,
      invitationCode: 'GOODCODE',
      code: 'GOODCODE',
      guestName: 'Jane Smith',
      email: 'jane.smith@example.com',
    });
  });
});
