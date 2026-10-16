/** @jest-environment node */

import { GET, PUT } from '../route';
import { NextRequest } from 'next/server';
import { getGuestInviteSession } from '@/core/auth/guestInviteSession';
import { prisma } from '@/lib/prisma';

jest.mock('@/core/auth/guestInviteSession', () => ({
  getGuestInviteSession: jest.fn(),
  GUEST_INVITE_COOKIE: 'guest_invite_session',
}));

jest.mock('@/lib/prisma', () => ({
  prisma: {
    invitationCode: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

const mockGetGuestInviteSession = getGuestInviteSession as jest.MockedFunction<typeof getGuestInviteSession>;
const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('Guest Postal Address API (/api/guest/address)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET', () => {
    test('returns 401 if guest session is missing or invalid', async () => {
      mockGetGuestInviteSession.mockResolvedValue(null);
      const req = new NextRequest('http://localhost/api/guest/address');

      const res = await GET(req);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('Unauthorized');
    });

    test('returns 404 if invitation code is not found in database', async () => {
      mockGetGuestInviteSession.mockResolvedValue({ code: 'NOTFOUND1', guestName: 'Guest' });
      (mockPrisma.invitationCode.findUnique as jest.Mock).mockResolvedValue(null);

      const req = new NextRequest('http://localhost/api/guest/address');
      const res = await GET(req);

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.success).toBe(false);
    });

    test('returns mailing address for authenticated guest session', async () => {
      mockGetGuestInviteSession.mockResolvedValue({ code: 'VALID100', guestName: 'Alice' });
      (mockPrisma.invitationCode.findUnique as jest.Mock).mockResolvedValue({
        id: 'code-1',
        code: 'VALID100',
        guestName: 'Alice',
        addressLine1: '123 Main St',
        addressLine2: 'Apt 4B',
        city: 'San Francisco',
        state: 'CA',
        zipCode: '94102',
        country: 'United States',
      });

      const req = new NextRequest('http://localhost/api/guest/address');
      const res = await GET(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data).toEqual({
        guestName: 'Alice',
        code: 'VALID100',
        addressLine1: '123 Main St',
        addressLine2: 'Apt 4B',
        city: 'San Francisco',
        state: 'CA',
        zipCode: '94102',
        country: 'United States',
      });
    });
  });

  describe('PUT', () => {
    test('returns 401 if guest session is missing or invalid', async () => {
      mockGetGuestInviteSession.mockResolvedValue(null);
      const req = new NextRequest('http://localhost/api/guest/address', {
        method: 'PUT',
        body: JSON.stringify({ addressLine1: '123 Main St' }),
      });

      const res = await PUT(req);
      expect(res.status).toBe(401);
    });

    test('returns 400 if payload fails Zod schema validation (too long)', async () => {
      mockGetGuestInviteSession.mockResolvedValue({ code: 'VALID100', guestName: 'Alice' });
      const req = new NextRequest('http://localhost/api/guest/address', {
        method: 'PUT',
        body: JSON.stringify({
          addressLine1: 'A'.repeat(200), // Exceeds 150 limit
        }),
      });

      const res = await PUT(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Address Line 1 must be under 150 characters.');
    });

    test('updates mailing address and returns 200 on valid submission', async () => {
      mockGetGuestInviteSession.mockResolvedValue({ code: 'VALID100', guestName: 'Alice' });
      (mockPrisma.invitationCode.findUnique as jest.Mock).mockResolvedValue({
        id: 'code-1',
        code: 'VALID100',
        guestName: 'Alice',
      });
      (mockPrisma.invitationCode.update as jest.Mock).mockResolvedValue({
        id: 'code-1',
        code: 'VALID100',
        guestName: 'Alice',
        addressLine1: '456 Market St',
        addressLine2: '',
        city: 'Oakland',
        state: 'CA',
        zipCode: '94607',
        country: 'United States',
      });

      const payload = {
        addressLine1: '456 Market St',
        city: 'Oakland',
        state: 'CA',
        zipCode: '94607',
        country: 'United States',
      };

      const req = new NextRequest('http://localhost/api/guest/address', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });

      const res = await PUT(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.addressLine1).toBe('456 Market St');
      expect(body.data.city).toBe('Oakland');
    });
  });
});
