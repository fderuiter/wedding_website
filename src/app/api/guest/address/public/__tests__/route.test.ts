/** @jest-environment node */

import { POST } from '../route';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resetRateLimitsForTesting } from '@/utils/rateLimit';
import { GUEST_COOKIE, signGuestToken } from '@/core/auth/guest.server';
import { GUEST_INVITE_COOKIE, signGuestInviteSessionToken } from '@/core/auth/guestInviteSession';
import { createVerifiedSocketIpHeaders } from '@/lib/socket-ip-boundary.js';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    invitationCode: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('Public Address Collection API (/api/guest/address/public)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimitsForTesting();
    (mockPrisma.invitationCode.findFirst as jest.Mock).mockResolvedValue(null);
    (mockPrisma.invitationCode.findMany as jest.Mock).mockResolvedValue([]);
  });

  test('creates new InvitationCode with partyTags ["address-collection"], saves notes in extraFields.householdNotes (not dietaryNotes), and returns enumeration-safe response', async () => {
    (mockPrisma.invitationCode.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.invitationCode.create as jest.Mock).mockImplementation(async ({ data }) => ({
      id: 'generated-id-1',
      ...data,
    }));

    const payload = {
      guestName: 'Jane Prospect',
      householdName: 'Prospect Family',
      email: 'jane@example.com',
      addressLine1: '789 Oak Ave',
      city: 'Austin',
      state: 'TX',
      zipCode: '78701',
      country: 'United States',
      notes: 'Family of 3 - Baby Leo arriving in May',
    };

    const req = new NextRequest('http://localhost/api/guest/address/public', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message: 'Address submitted successfully.',
    });
    expect(body.data).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('789 Oak Ave');

    expect(mockPrisma.invitationCode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isSample: false },
      })
    );
    expect(mockPrisma.invitationCode.create).toHaveBeenCalledTimes(1);
    const createdData = (mockPrisma.invitationCode.create as jest.Mock).mock.calls[0][0].data;
    expect(createdData.guestName).toBe('Jane Prospect');
    expect(createdData.householdName).toBe('Prospect Family');
    expect(createdData.partyTags).toEqual(['address-collection']);
    expect(createdData.addressLine1).toBe('789 Oak Ave');
    expect(createdData.dietaryNotes).toBeNull();
    expect(createdData.extraFields).toEqual({
      householdNotes: 'Family of 3 - Baby Leo arriving in May',
    });
  });

  test('matches active non-sample invited guest via resolveBatchGuestMatches and populates blank contact fields without adding address-collection tag or overwriting existing values', async () => {
    (mockPrisma.invitationCode.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'invited-1',
        code: 'SECRET2026',
        guestName: 'Jane Prospect',
        email: 'jane@example.com',
        householdName: null,
        addressLine1: null,
        addressLine2: null,
        city: null,
        state: null,
        zipCode: null,
        country: null,
        dietaryNotes: 'Gluten-free',
        partyTags: ['Bride Family'],
        extraFields: { attendanceStatus: 'pending' },
      },
    ]);
    (mockPrisma.invitationCode.update as jest.Mock).mockResolvedValue({});

    const payload = {
      guestName: 'Jane Prospect',
      householdName: 'The Prospect Household',
      email: '  JANE@EXAMPLE.COM  ',
      phone: '+1 (555) 222-3333',
      addressLine1: '789 Oak Ave',
      addressLine2: 'Apt 4B',
      city: 'Austin',
      state: 'TX',
      zipCode: '78701',
      country: 'United States',
      notes: 'Moving next year, good through Dec',
    };

    const req = new NextRequest('http://localhost/api/guest/address/public', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message: 'Address submitted successfully.',
    });
    expect(JSON.stringify(body)).not.toContain('SECRET2026');
    expect(JSON.stringify(body)).not.toContain('789 Oak Ave');

    expect(mockPrisma.invitationCode.create).not.toHaveBeenCalled();
    expect(mockPrisma.invitationCode.update).toHaveBeenCalledTimes(1);
    const updateCall = (mockPrisma.invitationCode.update as jest.Mock).mock.calls[0][0];
    expect(updateCall.where).toEqual({ id: 'invited-1' });
    expect(updateCall.data).toEqual({
      householdName: 'The Prospect Household',
      addressLine1: '789 Oak Ave',
      addressLine2: 'Apt 4B',
      city: 'Austin',
      state: 'TX',
      zipCode: '78701',
      country: 'United States',
      extraFields: {
        attendanceStatus: 'pending',
        phone: '+15552223333',
        mobile: '+15552223333',
        householdNotes: 'Moving next year, good through Dec',
      },
    });
    // Must NOT add 'address-collection' tag or touch dietaryNotes
    expect(updateCall.data.partyTags).toBeUndefined();
    expect(updateCall.data.dietaryNotes).toBeUndefined();
  });

  test('preserves non-empty addressLine1 on matched guest and inserts conflicting addressLine1 submission as an address-collection row for admin merge review', async () => {
    (mockPrisma.invitationCode.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.invitationCode.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'invited-existing-addr',
        code: 'JOHN2026',
        guestName: 'John Doe',
        email: 'john@example.com',
        householdName: 'Doe Family',
        addressLine1: '500 Original Blvd',
        addressLine2: null,
        city: 'Portland',
        state: 'OR',
        zipCode: '97201',
        country: 'United States',
        partyTags: ['VIP'],
        extraFields: null,
      },
    ]);
    (mockPrisma.invitationCode.create as jest.Mock).mockImplementation(async ({ data }) => ({
      id: 'conflict-staging-id',
      ...data,
    }));

    const payload = {
      guestName: '  john doe  ',
      email: 'john@example.com',
      addressLine1: '123 Pine St',
      city: 'Seattle',
      state: 'WA',
      zipCode: '98101',
      country: 'United States',
      notes: 'New Seattle apartment',
    };

    const req = new NextRequest('http://localhost/api/guest/address/public', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message: 'Address submitted successfully.',
    });
    expect(JSON.stringify(body)).not.toContain('JOHN2026');
    expect(JSON.stringify(body)).not.toContain('500 Original Blvd');

    // Existing guest row's addressLine1 was NOT overwritten
    expect(mockPrisma.invitationCode.update).not.toHaveBeenCalled();
    // Conflicting address was staged as 'address-collection' for admin merge review
    expect(mockPrisma.invitationCode.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.invitationCode.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        code: expect.any(String),
        guestName: 'john doe',
        email: 'john@example.com',
        addressLine1: '123 Pine St',
        city: 'Seattle',
        state: 'WA',
        zipCode: '98101',
        country: 'United States',
        dietaryNotes: null,
        extraFields: {
          householdNotes: 'New Seattle apartment',
        },
        partyTags: ['address-collection'],
        used: false,
      }),
    });
  });

  test('persists notes in extraFields.householdNotes (never dietaryNotes) on unmatched submissions', async () => {
    (mockPrisma.invitationCode.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.invitationCode.create as jest.Mock).mockImplementation(async ({ data }) => ({
      id: 'new-guest-diet-1',
      ...data,
    }));

    const payload = {
      guestName: 'Alice Smith',
      email: 'alice@example.com',
      addressLine1: '2 Second Ave',
      notes: 'Ring bell #2 for parcels',
    };

    const req = new NextRequest('http://localhost/api/guest/address/public', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    expect(mockPrisma.invitationCode.update).not.toHaveBeenCalled();
    expect(mockPrisma.invitationCode.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          guestName: 'Alice Smith',
          dietaryNotes: null,
          extraFields: {
            householdNotes: 'Ring bell #2 for parcels',
          },
          partyTags: ['address-collection'],
        }),
      })
    );
  });

  test('creates new record with null dietary notes when notes are not provided', async () => {
    (mockPrisma.invitationCode.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.invitationCode.create as jest.Mock).mockImplementation(async ({ data }) => ({
      id: 'new-guest-diet-2',
      ...data,
    }));

    const payload = {
      guestName: 'Bob Brown',
      email: 'bob@example.com',
      addressLine1: '10 Maple St',
    };

    const req = new NextRequest('http://localhost/api/guest/address/public', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    expect(mockPrisma.invitationCode.update).not.toHaveBeenCalled();
    expect(mockPrisma.invitationCode.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          guestName: 'Bob Brown',
          dietaryNotes: null,
          partyTags: ['address-collection'],
        }),
      })
    );
  });

  test('returns 400 Bad Request when guestName is missing', async () => {
    const payload = {
      email: 'jane@example.com',
      addressLine1: '789 Oak Ave',
    };

    const req = new NextRequest('http://localhost/api/guest/address/public', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('Guest name is required');
    expect(mockPrisma.invitationCode.create).not.toHaveBeenCalled();
  });

  test('returns 400 Bad Request when field exceeds max length', async () => {
    const payload = {
      guestName: 'A'.repeat(105), // Exceeds 100 limit
    };

    const req = new NextRequest('http://localhost/api/guest/address/public', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(mockPrisma.invitationCode.create).not.toHaveBeenCalled();
  });

  test('returns 200 OK without database record creation when honeypot field is filled', async () => {
    const payload = {
      guestName: 'Spam Bot',
      email: 'bot@spam.com',
      website: 'http://spam.com', // Honeypot field filled!
    };

    const req = new NextRequest('http://localhost/api/guest/address/public', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockPrisma.invitationCode.create).not.toHaveBeenCalled();
  });

  test('enforces rate limiting of 10 requests per 15 minutes', async () => {
    (mockPrisma.invitationCode.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.invitationCode.create as jest.Mock).mockImplementation(async ({ data }) => ({
      id: 'id-1',
      ...data,
    }));

    const payload = { guestName: 'Rate Limit Test' };

    // Send 10 valid requests
    for (let i = 0; i < 10; i++) {
      const req = new NextRequest('http://localhost/api/guest/address/public', {
        method: 'POST',
        headers: { 'x-forwarded-for': '192.168.1.50' },
        body: JSON.stringify(payload),
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
    }

    // 11th request should trigger 429 Too Many Requests
    const req11 = new NextRequest('http://localhost/api/guest/address/public', {
      method: 'POST',
      headers: { 'x-forwarded-for': '192.168.1.50' },
      body: JSON.stringify(payload),
    });

    const res11 = await POST(req11);
    expect(res11.status).toBe(429);
  });

  describe('Phone number handling & extraFields persistence', () => {
    test('creates new InvitationCode with extraFields containing phone and mobile when valid phone is provided', async () => {
      (mockPrisma.invitationCode.findUnique as jest.Mock).mockResolvedValue(null);
      (mockPrisma.invitationCode.create as jest.Mock).mockImplementation(async ({ data }) => ({
        id: 'phone-guest-id',
        ...data,
      }));

      const payload = {
        guestName: 'Phone Guest',
        email: 'phoneguest@example.com',
        phone: '+1 (555) 123-4567',
        addressLine1: '100 Main St',
      };

      const req = new NextRequest('http://localhost/api/guest/address/public', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(mockPrisma.invitationCode.create).toHaveBeenCalledTimes(1);

      const createdData = (mockPrisma.invitationCode.create as jest.Mock).mock.calls[0][0].data;
      expect(createdData.guestName).toBe('Phone Guest');
      expect(createdData.extraFields).toEqual({
        phone: '+15551234567',
        mobile: '+15551234567',
      });
    });

    test('strips formatting characters and accepts numbers up to 30 characters', async () => {
      (mockPrisma.invitationCode.findUnique as jest.Mock).mockResolvedValue(null);
      (mockPrisma.invitationCode.create as jest.Mock).mockImplementation(async ({ data }) => ({
        id: 'strip-guest-id',
        ...data,
      }));

      const payload = {
        guestName: 'Format Guest',
        phone: '  +1-555.234.5678  ',
      };

      const req = new NextRequest('http://localhost/api/guest/address/public', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const createdData = (mockPrisma.invitationCode.create as jest.Mock).mock.calls[0][0].data;
      expect(createdData.extraFields).toEqual({
        phone: '+15552345678',
        mobile: '+15552345678',
      });
    });

    test('accepts phone via mobile or phoneNumber alias and persists to extraFields', async () => {
      (mockPrisma.invitationCode.findUnique as jest.Mock).mockResolvedValue(null);
      (mockPrisma.invitationCode.create as jest.Mock).mockImplementation(async ({ data }) => ({
        id: 'alias-guest-id',
        ...data,
      }));

      const payload = {
        guestName: 'Alias Guest',
        mobile: '+15559876543',
      };

      const req = new NextRequest('http://localhost/api/guest/address/public', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const createdData = (mockPrisma.invitationCode.create as jest.Mock).mock.calls[0][0].data;
      expect(createdData.extraFields).toEqual({
        phone: '+15559876543',
        mobile: '+15559876543',
      });
    });

    test('creates new record with phone in extraFields when submission email matches existing record', async () => {
      (mockPrisma.invitationCode.findUnique as jest.Mock).mockResolvedValue(null);
      (mockPrisma.invitationCode.create as jest.Mock).mockImplementation(async ({ data }) => ({
        id: 'new-phone-email-id',
        ...data,
      }));

      const payload = {
        guestName: 'Existing Guest',
        email: 'merge@example.com',
        phone: '+1 (555) 333-4444',
      };

      const req = new NextRequest('http://localhost/api/guest/address/public', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      expect(mockPrisma.invitationCode.update).not.toHaveBeenCalled();
      expect(mockPrisma.invitationCode.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.invitationCode.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            guestName: 'Existing Guest',
            email: 'merge@example.com',
            extraFields: {
              phone: '+15553334444',
              mobile: '+15553334444',
            },
            partyTags: ['address-collection'],
          }),
        })
      );
    });

    test('creates new record with phone in extraFields when submission guest name matches existing record', async () => {
      (mockPrisma.invitationCode.findUnique as jest.Mock).mockResolvedValue(null);
      (mockPrisma.invitationCode.create as jest.Mock).mockImplementation(async ({ data }) => ({
        id: 'new-phone-name-id',
        ...data,
      }));

      const payload = {
        guestName: 'Guest Matching By Name',
        phone: '+1 (555) 444-5555',
      };

      const req = new NextRequest('http://localhost/api/guest/address/public', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      expect(mockPrisma.invitationCode.update).not.toHaveBeenCalled();
      expect(mockPrisma.invitationCode.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.invitationCode.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            guestName: 'Guest Matching By Name',
            extraFields: {
              phone: '+15554445555',
              mobile: '+15554445555',
            },
            partyTags: ['address-collection'],
          }),
        })
      );
    });

    test('returns 400 Bad Request with informative error message on invalid phone format', async () => {
      const payload = {
        guestName: 'Invalid Guest',
        phone: 'not-a-valid-phone',
      };

      const req = new NextRequest('http://localhost/api/guest/address/public', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      const res = await POST(req);
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('Invalid phone number format');
      expect(mockPrisma.invitationCode.create).not.toHaveBeenCalled();
    });

    test('returns 400 Bad Request when phone exceeds 30 characters', async () => {
      const payload = {
        guestName: 'Long Phone Guest',
        phone: '+1234567890123456789012345678901', // 32 characters
      };

      const req = new NextRequest('http://localhost/api/guest/address/public', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      const res = await POST(req);
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.success).toBe(false);
      expect(mockPrisma.invitationCode.create).not.toHaveBeenCalled();
    });
  });

  describe('HTML bracket & control character rejection', () => {
    test('returns 400 Bad Request when guestName or householdName contains HTML brackets or control characters', async () => {
      const htmlPayload = {
        guestName: '<b data-canary="guest-html-marker">CanaryGuest</b>',
        householdName: '<i data-canary="household-html-marker">CanaryHousehold</i>',
        email: 'canary-recipient@example.invalid',
      };

      const req1 = new NextRequest('http://localhost/api/guest/address/public', {
        method: 'POST',
        body: JSON.stringify(htmlPayload),
      });
      const res1 = await POST(req1);
      expect(res1.status).toBe(400);

      const req2 = new NextRequest('http://localhost/api/guest/address/public', {
        method: 'POST',
        body: JSON.stringify({
          guestName: 'Valid Guest',
          householdName: 'Household\nInjected',
        }),
      });
      const res2 = await POST(req2);
      expect(res2.status).toBe(400);

      expect(mockPrisma.invitationCode.create).not.toHaveBeenCalled();
    });

    test('accepts apostrophes, hyphens, periods, and international letters', async () => {
      (mockPrisma.invitationCode.findUnique as jest.Mock).mockResolvedValue(null);
      (mockPrisma.invitationCode.create as jest.Mock).mockImplementation(async ({ data }) => ({
        id: 'intl-guest-id',
        ...data,
      }));

      const req = new NextRequest('http://localhost/api/guest/address/public', {
        method: 'POST',
        body: JSON.stringify({
          guestName: "Élodie O'Connor-St. Clair",
          householdName: "O'Connor & Müller-Søren.",
          email: 'elodie@example.com',
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(mockPrisma.invitationCode.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            guestName: "Élodie O'Connor-St. Clair",
            householdName: "O'Connor & Müller-Søren.",
            partyTags: ['address-collection'],
          }),
        })
      );
    });
  });

  describe('Strict IP Rate Limiting Against Cookie Rotation', () => {
    test('returns HTTP 429 on request 11 from one IP even when rotating fresh guest_auth and guest_invite_session cookies', async () => {
      (mockPrisma.invitationCode.findUnique as jest.Mock).mockResolvedValue(null);
      (mockPrisma.invitationCode.create as jest.Mock).mockImplementation(async ({ data }) => ({
        id: `addr-${data.code}`,
        ...data,
      }));

      const fixedIpHeaders = createVerifiedSocketIpHeaders('198.51.100.88');
      const now = Date.now();
      const exp = now + 60 * 60 * 1000;

      for (let i = 1; i <= 10; i++) {
        const rotatedCookie =
          i % 2 === 0
            ? `${GUEST_COOKIE}=${await signGuestToken({
              guest: true,
              jti: `rotated-jti-${i}`,
              iat: now + i,
              exp,
            })}`
            : `${GUEST_INVITE_COOKIE}=${await signGuestInviteSessionToken({
              code: `ROTATE${i}`,
              guestName: `Guest ${i}`,
              iat: now + i,
              exp,
            })}`;

        const req = new NextRequest('http://localhost/api/guest/address/public', {
          method: 'POST',
          headers: {
            ...fixedIpHeaders,
            cookie: rotatedCookie,
          },
          body: JSON.stringify({
            guestName: `Prospect ${i}`,
            email: `prospect${i}@example.com`,
            addressLine1: `${i} Elm St`,
          }),
        });

        const res = await POST(req);
        expect(res.status).toBe(200);
      }

      const eleventhCookie = `${GUEST_COOKIE}=${await signGuestToken({
        guest: true,
        jti: 'rotated-jti-11',
        iat: now + 11,
        exp,
      })}`;
      const eleventhReq = new NextRequest('http://localhost/api/guest/address/public', {
        method: 'POST',
        headers: {
          ...fixedIpHeaders,
          cookie: eleventhCookie,
        },
        body: JSON.stringify({
          guestName: 'Prospect 11',
          email: 'prospect11@example.com',
          addressLine1: '11 Elm St',
        }),
      });

      const eleventhRes = await POST(eleventhReq);
      expect(eleventhRes.status).toBe(429);
      const eleventhBody = await eleventhRes.json();
      expect(eleventhBody.success).toBe(false);
      expect(mockPrisma.invitationCode.create).toHaveBeenCalledTimes(10);
    });
  });
});
