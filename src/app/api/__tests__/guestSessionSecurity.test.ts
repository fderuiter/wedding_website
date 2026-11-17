/** @jest-environment node */

import { NextRequest } from 'next/server';
import { POST as rsvpPost } from '@/app/api/rsvp/route';
import { GET as addressGet, PUT as addressPut } from '@/app/api/guest/address/route';
import { GET as scheduleGet } from '@/app/api/schedule/route';
import {
  signGuestInviteSessionToken,
  GUEST_INVITE_COOKIE,
} from '@/core/auth/guestInviteSession';
import { env } from '@/env';
import { base64urlEncode, hmacSha256 } from '@/utils/crypto';
import { prisma } from '@/lib/prisma';
import { subEventService } from '@/features/sub-events';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    invitationCode: {
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
});
