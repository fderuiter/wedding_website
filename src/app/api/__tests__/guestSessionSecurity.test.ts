/** @jest-environment node */

import { NextRequest } from 'next/server';
import { POST as guestLoginPost } from '@/app/api/guest/login/route';
import { POST as guestLookupPost } from '@/app/api/guest/lookup/route';
import { POST as rsvpPost } from '@/app/api/rsvp/route';
import { GET as addressGet, PUT as addressPut } from '@/app/api/guest/address/route';
import { GET as guestSessionGet } from '@/app/api/guest/session/route';
import { GET as scheduleGet } from '@/app/api/schedule/route';
import { GET as photosGet } from '@/app/api/photos/route';
import { GET as registryItemsGet } from '@/app/api/registry/items/route';
import { POST as guestPhotosUploadPost } from '@/app/api/guest/photos/upload/route';
import { ADMIN_COOKIE, signAdminToken } from '@/core/auth/auth.server';
import { GUEST_COOKIE, signGuestToken } from '@/core/auth/guest.server';
import {
  signGuestInviteSessionToken,
  GUEST_INVITE_COOKIE,
} from '@/core/auth/guestInviteSession';
import { env } from '@/env';
import { base64urlEncode, hmacSha256 } from '@/utils/crypto';
import { resetRateLimitsForTesting } from '@/utils/rateLimit';
import { prisma } from '@/lib/prisma';
import { subEventService } from '@/features/sub-events';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    invitationCode: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock('@/features/sub-events/service', () => ({
  subEventService: {
    submitSubEventRsvps: jest.fn(),
    getScheduleForGuest: jest.fn(),
  },
}));

describe('Guest Session Security Integration', () => {
  const mockPrisma = prisma as jest.Mocked<typeof prisma>;
  const mockSubEventService = subEventService as jest.Mocked<typeof subEventService>;

  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimitsForTesting();
  });

  async function createForgedPasscodeToken(payload: { code: string; guestName: string; exp?: number }): Promise<string> {
    const data = base64urlEncode(JSON.stringify({
      ...payload,
      iat: Date.now(),
      exp: payload.exp ?? Date.now() + 7 * 24 * 60 * 60 * 1000,
    }));
    const forgedSignature = await hmacSha256(env.GUEST_PASSCODE, data);
    return `${data}.${forgedSignature}`;
  }

  async function createForgedDefaultSecretToken(payload: { code: string; guestName: string; exp?: number }): Promise<string> {
    const data = base64urlEncode(JSON.stringify({
      ...payload,
      iat: Date.now(),
      exp: payload.exp ?? Date.now() + 7 * 24 * 60 * 60 * 1000,
    }));
    const forgedSignature = await hmacSha256('default-guest-session-secret', data);
    return `${data}.${forgedSignature}`;
  }

  describe('/api/guest/address', () => {
    test('accepts legitimate guest session cookie and returns guest address details', async () => {
      const legitimateToken = await signGuestInviteSessionToken({
        code: 'VALIDGUEST',
        guestName: 'Valid Guest',
      });

      (mockPrisma.invitationCode.findUnique as jest.Mock).mockResolvedValue({
        id: 'code-1',
        code: 'VALIDGUEST',
        guestName: 'Valid Guest',
        addressLine1: '123 Harbor View',
        addressLine2: 'Suite 400',
        city: 'Newport',
        state: 'RI',
        zipCode: '02840',
        country: 'United States',
      });

      const req = new NextRequest('http://localhost:3000/api/guest/address', {
        method: 'GET',
        headers: {
          cookie: `${GUEST_INVITE_COOKIE}=${legitimateToken}`,
        },
      });

      const res = await addressGet(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.guestName).toBe('Valid Guest');
      expect(json.data.code).toBe('VALIDGUEST');
      expect(json.data.addressLine1).toBe('123 Harbor View');
    });

    test('shared passcode login followed by guest lookup does not mint guest_invite_session or authorize /api/guest/address', async () => {
      const originalPasscode = process.env.GUEST_PASSCODE;
      process.env.GUEST_PASSCODE = 'test-guest-passcode';

      const cookieJar = new Map<string, string>();
      const recordCookies = (res: Response) => {
        const setCookie = res.headers.get('set-cookie');
        if (!setCookie) return;
        for (const segment of setCookie.split(/,(?=\s*[A-Za-z0-9_-]+=)/)) {
          const firstPair = segment.split(';')[0]?.trim();
          if (!firstPair) continue;
          const eqIdx = firstPair.indexOf('=');
          if (eqIdx > 0) {
            cookieJar.set(firstPair.slice(0, eqIdx), firstPair.slice(eqIdx + 1));
          }
        }
      };

      const request = async (
        path: '/api/guest/login' | '/api/guest/lookup' | '/api/guest/address' | '/api/rsvp' | '/api/schedule',
        init: { method: string; headers?: Record<string, string>; body?: string }
      ) => {
        const cookieHeader = Array.from(cookieJar.entries())
          .map(([k, v]) => `${k}=${v}`)
          .join('; ');
        const headers: Record<string, string> = { ...(init.headers ?? {}) };
        if (cookieHeader) {
          headers.cookie = cookieHeader;
        }
        const req = new NextRequest(`http://localhost:3000${path}`, {
          method: init.method,
          headers,
          body: init.body,
        });

        let res: Response;
        if (path === '/api/guest/login') {
          res = await guestLoginPost(req);
        } else if (path === '/api/guest/lookup') {
          res = await guestLookupPost(req);
        } else if (path === '/api/guest/address') {
          res = init.method === 'PUT' ? await addressPut(req) : await addressGet(req);
        } else if (path === '/api/rsvp') {
          res = await rsvpPost(req, {});
        } else {
          res = await scheduleGet(req);
        }
        recordCookies(res);
        return res;
      };

      try {
        const loginRes = await request('/api/guest/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ passcode: 'test-guest-passcode' }),
        });
        expect(loginRes.status).toBe(200);
        expect(cookieJar.has(GUEST_COOKIE)).toBe(true);
        expect(cookieJar.has(GUEST_INVITE_COOKIE)).toBe(false);

        // Single-token surname query ("Vance") does not match plus-one surname or mint session
        (mockPrisma.invitationCode.findFirst as jest.Mock).mockResolvedValueOnce(null);
        const lookupRes = await request('/api/guest/lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Vance' }),
        });
        expect(lookupRes.status).toBe(404);
        expect(cookieJar.has(GUEST_INVITE_COOKIE)).toBe(false);

        const addrRead = await request('/api/guest/address', { method: 'GET' });
        expect(addrRead.status).toBe(401);
        expect(cookieJar.has(GUEST_INVITE_COOKIE)).toBe(false);

        // Even when a full guest name matches in /api/guest/lookup, no guest_invite_session is minted
        (mockPrisma.invitationCode.findFirst as jest.Mock).mockResolvedValueOnce({
          id: 'inv-vance',
          code: 'VANCE2026',
          guestName: 'Eleanor Vance',
          addressLine1: '742 Evergreen Terrace',
        });
        const matchedLookupRes = await request('/api/guest/lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Eleanor Vance' }),
        });
        expect(matchedLookupRes.status).toBe(200);
        expect(cookieJar.has(GUEST_INVITE_COOKIE)).toBe(false);

        const addrReadAfterMatch = await request('/api/guest/address', { method: 'GET' });
        expect(addrReadAfterMatch.status).toBe(401);

        const rsvpAttempt = await request('/api/rsvp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subEventId: 'se-100', status: 'declined' }),
        });
        expect(rsvpAttempt.status).toBe(401);

        mockSubEventService.getScheduleForGuest.mockResolvedValueOnce([]);
        const scheduleRes = await request('/api/schedule', { method: 'GET' });
        const scheduleJson = await scheduleRes.json();
        expect(scheduleJson.isGuest).toBe(false);
        expect(mockSubEventService.getScheduleForGuest).toHaveBeenCalledWith(undefined);
      } finally {
        if (originalPasscode === undefined) {
          delete process.env.GUEST_PASSCODE;
        } else {
          process.env.GUEST_PASSCODE = originalPasscode;
        }
      }
    });

    test('rejects forged token signed with shared GUEST_PASSCODE with 401 response', async () => {
      const forgedToken = await createForgedPasscodeToken({
        code: 'VICTIMGUEST',
        guestName: 'Victim Guest',
      });

      const req = new NextRequest('http://localhost:3000/api/guest/address', {
        method: 'GET',
        headers: {
          cookie: `${GUEST_INVITE_COOKIE}=${forgedToken}`,
        },
      });

      const res = await addressGet(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toMatch(/Unauthorized/i);
      expect(mockPrisma.invitationCode.findUnique).not.toHaveBeenCalled();
    });

    test('rejects forged token signed with static default secret with 401 response', async () => {
      const forgedToken = await createForgedDefaultSecretToken({
        code: 'VICTIMGUEST',
        guestName: 'Victim Guest',
      });

      const req = new NextRequest('http://localhost:3000/api/guest/address', {
        method: 'GET',
        headers: {
          cookie: `${GUEST_INVITE_COOKIE}=${forgedToken}`,
        },
      });

      const res = await addressGet(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toMatch(/Unauthorized/i);
      expect(mockPrisma.invitationCode.findUnique).not.toHaveBeenCalled();
    });

    test('PUT /api/guest/address accepts legitimate session cookie and updates address', async () => {
      const legitimateToken = await signGuestInviteSessionToken({
        code: 'VALIDGUEST',
        guestName: 'Valid Guest',
      });

      (mockPrisma.invitationCode.findUnique as jest.Mock).mockResolvedValue({
        id: 'code-1',
        code: 'VALIDGUEST',
        guestName: 'Valid Guest',
      });
      (mockPrisma.invitationCode.update as jest.Mock).mockResolvedValue({
        id: 'code-1',
        code: 'VALIDGUEST',
        guestName: 'Valid Guest',
        addressLine1: '456 Updated St',
        city: 'Providence',
        state: 'RI',
        zipCode: '02903',
        country: 'United States',
      });

      const req = new NextRequest('http://localhost:3000/api/guest/address', {
        method: 'PUT',
        headers: {
          cookie: `${GUEST_INVITE_COOKIE}=${legitimateToken}`,
        },
        body: JSON.stringify({
          addressLine1: '456 Updated St',
          city: 'Providence',
          state: 'RI',
          zipCode: '02903',
          country: 'United States',
        }),
      });

      const res = await addressPut(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.addressLine1).toBe('456 Updated St');
    });

    test('PUT /api/guest/address rejects forged token signed with shared GUEST_PASSCODE with 401 response', async () => {
      const forgedToken = await createForgedPasscodeToken({
        code: 'VICTIMGUEST',
        guestName: 'Victim Guest',
      });

      const req = new NextRequest('http://localhost:3000/api/guest/address', {
        method: 'PUT',
        headers: {
          cookie: `${GUEST_INVITE_COOKIE}=${forgedToken}`,
        },
        body: JSON.stringify({
          addressLine1: 'Hacked Address',
          city: 'Anytown',
          state: 'CA',
          zipCode: '90001',
          country: 'United States',
        }),
      });

      const res = await addressPut(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(mockPrisma.invitationCode.update).not.toHaveBeenCalled();
    });

    test('PUT /api/guest/address rejects forged token signed with static default secret with 401 response', async () => {
      const forgedToken = await createForgedDefaultSecretToken({
        code: 'VICTIMGUEST',
        guestName: 'Victim Guest',
      });

      const req = new NextRequest('http://localhost:3000/api/guest/address', {
        method: 'PUT',
        headers: {
          cookie: `${GUEST_INVITE_COOKIE}=${forgedToken}`,
        },
        body: JSON.stringify({
          addressLine1: 'Hacked Address',
          city: 'Anytown',
          state: 'CA',
          zipCode: '90001',
          country: 'United States',
        }),
      });

      const res = await addressPut(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(mockPrisma.invitationCode.update).not.toHaveBeenCalled();
    });
  });

  describe('/api/rsvp', () => {
    test('accepts legitimate guest session cookie and submits RSVP', async () => {
      const legitimateToken = await signGuestInviteSessionToken({
        code: 'VALIDGUEST',
        guestName: 'Valid Guest',
      });

      (mockPrisma.invitationCode.findUnique as jest.Mock).mockResolvedValue({
        id: 'code-1',
        code: 'VALIDGUEST',
        guestName: 'Valid Guest',
        isSample: false,
      });

      mockSubEventService.submitSubEventRsvps.mockResolvedValue([
        {
          id: 'rsvp-1',
          subEventId: 'se-100',
          invitationCodeId: 'inv-1',
          status: 'attending',
          plusOneCount: 0,
          dietaryNotes: '',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const req = new NextRequest('http://localhost:3000/api/rsvp', {
        method: 'POST',
        headers: {
          cookie: `${GUEST_INVITE_COOKIE}=${legitimateToken}`,
        },
        body: JSON.stringify({
          subEventId: 'se-100',
          status: 'attending',
        }),
      });

      const res = await rsvpPost(req, {});
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(mockSubEventService.submitSubEventRsvps).toHaveBeenCalledWith('VALIDGUEST', [
        { subEventId: 'se-100', status: 'attending', plusOneCount: 0, dietaryNotes: '' },
      ]);
    });

    test('rejects forged token signed with shared GUEST_PASSCODE with 401 response', async () => {
      const forgedToken = await createForgedPasscodeToken({
        code: 'VICTIMGUEST',
        guestName: 'Victim Guest',
      });

      const req = new NextRequest('http://localhost:3000/api/rsvp', {
        method: 'POST',
        headers: {
          cookie: `${GUEST_INVITE_COOKIE}=${forgedToken}`,
        },
        body: JSON.stringify({
          subEventId: 'se-100',
          status: 'declined',
        }),
      });

      const res = await rsvpPost(req, {});
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toMatch(/Unauthorized/i);
      expect(mockSubEventService.submitSubEventRsvps).not.toHaveBeenCalled();
    });

    test('rejects forged token signed with static default secret with 401 response', async () => {
      const forgedToken = await createForgedDefaultSecretToken({
        code: 'VICTIMGUEST',
        guestName: 'Victim Guest',
      });

      const req = new NextRequest('http://localhost:3000/api/rsvp', {
        method: 'POST',
        headers: {
          cookie: `${GUEST_INVITE_COOKIE}=${forgedToken}`,
        },
        body: JSON.stringify({
          subEventId: 'se-100',
          status: 'declined',
        }),
      });

      const res = await rsvpPost(req, {});
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toMatch(/Unauthorized/i);
      expect(mockSubEventService.submitSubEventRsvps).not.toHaveBeenCalled();
    });
  });

  describe('/api/schedule', () => {
    test('accepts legitimate guest session cookie and returns guest schedule', async () => {
      const legitimateToken = await signGuestInviteSessionToken({
        code: 'VALIDGUEST',
        guestName: 'Valid Guest',
      });

      (mockPrisma.invitationCode.findUnique as jest.Mock).mockResolvedValue({
        id: 'code-1',
        code: 'VALIDGUEST',
        guestName: 'Valid Guest',
        isSample: false,
      });

      mockSubEventService.getScheduleForGuest.mockResolvedValue([
        { id: 'se-1', title: 'Rehearsal Dinner' } as any,
      ]);

      const req = new NextRequest('http://localhost:3000/api/schedule', {
        method: 'GET',
        headers: {
          cookie: `${GUEST_INVITE_COOKIE}=${legitimateToken}`,
        },
      });

      const res = await scheduleGet(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.isGuest).toBe(true);
      expect(json.guestName).toBe('Valid Guest');
      expect(mockSubEventService.getScheduleForGuest).toHaveBeenCalledWith('VALIDGUEST');
    });

    test('treats forged token signed with shared GUEST_PASSCODE as unauthenticated', async () => {
      const forgedToken = await createForgedPasscodeToken({
        code: 'VICTIMGUEST',
        guestName: 'Victim Guest',
      });

      mockSubEventService.getScheduleForGuest.mockResolvedValue([]);

      const req = new NextRequest('http://localhost:3000/api/schedule', {
        method: 'GET',
        headers: {
          cookie: `${GUEST_INVITE_COOKIE}=${forgedToken}`,
        },
      });

      const res = await scheduleGet(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.isGuest).toBe(false);
      expect(json.guestName).toBeNull();
      expect(mockSubEventService.getScheduleForGuest).toHaveBeenCalledWith(undefined);
    });

    test('treats forged token signed with static default secret as unauthenticated', async () => {
      const forgedToken = await createForgedDefaultSecretToken({
        code: 'VICTIMGUEST',
        guestName: 'Victim Guest',
      });

      mockSubEventService.getScheduleForGuest.mockResolvedValue([]);

      const req = new NextRequest('http://localhost:3000/api/schedule', {
        method: 'GET',
        headers: {
          cookie: `${GUEST_INVITE_COOKIE}=${forgedToken}`,
        },
      });

      const res = await scheduleGet(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.isGuest).toBe(false);
      expect(json.guestName).toBeNull();
      expect(mockSubEventService.getScheduleForGuest).toHaveBeenCalledWith(undefined);
    });
  });

  describe('revoked, rotated, and sample invitation session enforcement', () => {
    test('rejects deleted or rotated guest_invite_session cookies with 401 across guest API routes when guest_auth and admin_auth are absent', async () => {
      const revokedToken = await signGuestInviteSessionToken({
        code: 'REVOKEME1',
        guestName: 'Disinvited Household',
      });
      (mockPrisma.invitationCode.findUnique as jest.Mock).mockResolvedValue(null);

      const cookieHeader = `${GUEST_INVITE_COOKIE}=${revokedToken}`;

      const photosRes = await photosGet(
        new NextRequest('http://localhost:3000/api/photos', {
          method: 'GET',
          headers: { cookie: cookieHeader },
        })
      );
      expect(photosRes.status).toBe(401);
      expect(photosRes.headers.get('set-cookie') || '').toContain('Max-Age=0');

      const registryRes = await registryItemsGet(
        new NextRequest('http://localhost:3000/api/registry/items', {
          method: 'GET',
          headers: { cookie: cookieHeader },
        }),
        {}
      );
      expect(registryRes.status).toBe(401);

      const lookupRes = await guestLookupPost(
        new NextRequest('http://localhost:3000/api/guest/lookup', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            cookie: cookieHeader,
          },
          body: JSON.stringify({ query: 'Alex Smith' }),
        })
      );
      expect(lookupRes.status).toBe(401);

      const scheduleRes = await scheduleGet(
        new NextRequest('http://localhost:3000/api/schedule', {
          method: 'GET',
          headers: { cookie: cookieHeader },
        })
      );
      expect(scheduleRes.status).toBe(401);

      const uploadRes = await guestPhotosUploadPost(
        new NextRequest('http://localhost:3000/api/guest/photos/upload', {
          method: 'POST',
          headers: { cookie: cookieHeader },
        })
      );
      expect(uploadRes.status).toBe(401);
    });

    test('preserves access when caller also holds a valid guest_auth or admin_auth cookie alongside a revoked guest_invite_session', async () => {
      const revokedToken = await signGuestInviteSessionToken({
        code: 'REVOKEME1',
        guestName: 'Disinvited Household',
      });
      (mockPrisma.invitationCode.findUnique as jest.Mock).mockResolvedValue(null);
      mockSubEventService.getScheduleForGuest.mockResolvedValue([]);

      const validGuestAuth = await signGuestToken({
        guest: true,
        exp: Date.now() + 60 * 60 * 1000,
      });

      const guestFallbackRes = await scheduleGet(
        new NextRequest('http://localhost:3000/api/schedule', {
          method: 'GET',
          headers: {
            cookie: `${GUEST_INVITE_COOKIE}=${revokedToken}; ${GUEST_COOKIE}=${validGuestAuth}`,
          },
        })
      );
      expect(guestFallbackRes.status).toBe(200);
      const guestJson = await guestFallbackRes.json();
      expect(guestJson.isGuest).toBe(false);

      const validAdminAuth = await signAdminToken({
        isAdmin: true,
        iat: Date.now(),
      });

      const adminFallbackRes = await scheduleGet(
        new NextRequest('http://localhost:3000/api/schedule', {
          method: 'GET',
          headers: {
            cookie: `${GUEST_INVITE_COOKIE}=${revokedToken}; ${ADMIN_COOKIE}=${validAdminAuth}`,
          },
        })
      );
      expect(adminFallbackRes.status).toBe(200);
    });

    test('rejects unpromoted address-collection records on POST /api/guest/login with 401 and sets zero session cookies', async () => {
      (mockPrisma.invitationCode.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'addr-col-1',
        code: 'ADDRONLY1',
        guestName: 'Unpromoted Prospect',
        isSample: false,
        partyTags: ['address-collection'],
      });

      const res = await guestLoginPost(
        new NextRequest('http://localhost:3000/api/guest/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ passcode: 'ADDRONLY1' }),
        })
      );

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(res.headers.get('set-cookie') || '').toBe('');
    });

    test('expires guest_invite_session and falls back to passcode status on GET /api/guest/session for unpromoted address-collection records', async () => {
      const unpromotedToken = await signGuestInviteSessionToken({
        code: 'ADDRONLY1',
        guestName: 'Unpromoted Prospect',
      });
      const validGuestAuth = await signGuestToken({
        guest: true,
        exp: Date.now() + 60 * 60 * 1000,
      });
      (mockPrisma.invitationCode.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'addr-col-1',
        code: 'ADDRONLY1',
        guestName: 'Unpromoted Prospect',
        isSample: false,
        partyTags: ['address-collection'],
      });

      const res = await guestSessionGet(
        new NextRequest('http://localhost:3000/api/guest/session', {
          method: 'GET',
          headers: {
            cookie: `${GUEST_INVITE_COOKIE}=${unpromotedToken}; ${GUEST_COOKIE}=${validGuestAuth}`,
          },
        }),
        {}
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual({
        status: 'passcode',
        isVerified: false,
        invitationCode: null,
        code: null,
        guestName: null,
        hasPasscodeSession: true,
      });
      expect(res.cookies.get(GUEST_INVITE_COOKIE)?.value).toBe('');
      expect(res.cookies.get(GUEST_COOKIE)).toBeUndefined();
    });
  });
});
