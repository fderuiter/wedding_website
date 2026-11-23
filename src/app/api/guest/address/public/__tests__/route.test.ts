/** @jest-environment node */

import { POST } from '../route';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resetRateLimitsForTesting } from '@/utils/rateLimit';

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

const basePostalFields = {
  addressLine1: '789 Oak Ave',
  city: 'Austin',
  state: 'TX',
  zipCode: '78701',
};

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
      ...basePostalFields,
      country: 'United States',
      notes: 'Family of 3 - Baby Leo arriving in May',
    };

    const req = new NextRequest('http://localhost/api/guest/address/public', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

    expect(mockPrisma.invitationCode.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.invitationCode.update).not.toHaveBeenCalled();
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

  test('quarantines submission matching an invited guest with blank contact fields as a new address-collection row without querying or updating existing guests', async () => {
    (mockPrisma.invitationCode.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.invitationCode.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'invited-1',
        code: 'SECRET2026',
        guestName: 'Jane Prospect',
        email: null,
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
    (mockPrisma.invitationCode.create as jest.Mock).mockImplementation(async ({ data }) => ({
      id: 'quarantined-invited-match-id',
      ...data,
    }));

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
      headers: { 'Content-Type': 'application/json' },
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

    expect(mockPrisma.invitationCode.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.invitationCode.update).not.toHaveBeenCalled();
    expect(mockPrisma.invitationCode.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.invitationCode.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        code: expect.any(String),
        guestName: 'Jane Prospect',
        householdName: 'The Prospect Household',
        email: 'JANE@EXAMPLE.COM',
        addressLine1: '789 Oak Ave',
        addressLine2: 'Apt 4B',
        city: 'Austin',
        state: 'TX',
        zipCode: '78701',
        country: 'United States',
        dietaryNotes: null,
        extraFields: {
          phone: '+15552223333',
          mobile: '+15552223333',
          householdNotes: 'Moving next year, good through Dec',
        },
        partyTags: ['address-collection'],
        used: false,
      }),
    });
  });

  test('stages submission matching an existing guest with an address as a new address-collection row for admin merge review without calling update', async () => {
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
      headers: { 'Content-Type': 'application/json' },
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

    expect(mockPrisma.invitationCode.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.invitationCode.update).not.toHaveBeenCalled();
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
      city: 'Boston',
      state: 'MA',
      zipCode: '02108',
      notes: 'Moving in June; vegan household note',
    };

    const req = new NextRequest('http://localhost/api/guest/address/public', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
            householdNotes: 'Moving in June; vegan household note',
          },
          partyTags: ['address-collection'],
        }),
      })
    );
  });

  test('creates new record with null dietary notes and omitted extraFields when notes and phone are not provided', async () => {
    (mockPrisma.invitationCode.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.invitationCode.create as jest.Mock).mockImplementation(async ({ data }) => ({
      id: 'new-guest-diet-2',
      ...data,
    }));

    const payload = {
      guestName: 'Bob Brown',
      email: 'bob@example.com',
      addressLine1: '10 Maple St',
      city: 'Chicago',
      state: 'IL',
      zipCode: '60601',
    };

    const req = new NextRequest('http://localhost/api/guest/address/public', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    expect(mockPrisma.invitationCode.update).not.toHaveBeenCalled();
    const createdData = (mockPrisma.invitationCode.create as jest.Mock).mock.calls[0][0].data;
    expect(createdData.guestName).toBe('Bob Brown');
    expect(createdData.dietaryNotes).toBeNull();
    expect(createdData.extraFields).toBeUndefined();
    expect(createdData.partyTags).toEqual(['address-collection']);
  });

  test('returns 400 Bad Request when guestName is missing', async () => {
    const payload = {
      email: 'jane@example.com',
      ...basePostalFields,
    };

    const req = new NextRequest('http://localhost/api/guest/address/public', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('Guest name is required');
    expect(mockPrisma.invitationCode.create).not.toHaveBeenCalled();
  });

  test.each([
    ['addressLine1', { ...basePostalFields, addressLine1: '   ' }, 'Street address is required'],
    ['city', { ...basePostalFields, city: '' }, 'City is required'],
    ['state', { ...basePostalFields, state: '' }, 'State / Province is required'],
    ['zipCode', { ...basePostalFields, zipCode: ' ' }, 'ZIP / Postal code is required'],
  ])(
    'returns 400 Bad Request with field details when %s is missing or blank',
    async (fieldName, postalOverride, expectedMessage) => {
      const req = new NextRequest('http://localhost/api/guest/address/public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guestName: 'Postal Check Guest',
          ...postalOverride,
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain(expectedMessage);
      expect(body.details?.[fieldName]?._errors?.[0]).toContain(expectedMessage);
      expect(mockPrisma.invitationCode.create).not.toHaveBeenCalled();
    }
  );

  test('returns 400 Bad Request when field exceeds max length', async () => {
    const payload = {
      guestName: 'A'.repeat(105), // Exceeds 100 limit
      ...basePostalFields,
    };

    const req = new NextRequest('http://localhost/api/guest/address/public', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
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

    const payload = {
      guestName: 'Rate Limit Test',
      ...basePostalFields,
    };

    // Send 10 valid requests
    for (let i = 0; i < 10; i++) {
      const req = new NextRequest('http://localhost/api/guest/address/public', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '192.168.1.50' },
        body: JSON.stringify(payload),
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
    }

    // 11th request should trigger 429 Too Many Requests
    const req11 = new NextRequest('http://localhost/api/guest/address/public', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '192.168.1.50' },
      body: JSON.stringify(payload),
    });

    const res11 = await POST(req11);
    expect(res11.status).toBe(429);
  });

  describe('Phone number handling & extraFields persistence', () => {
    test('creates new InvitationCode with extraFields containing phone, mobile, and householdNotes when provided', async () => {
      (mockPrisma.invitationCode.findUnique as jest.Mock).mockResolvedValue(null);
      (mockPrisma.invitationCode.create as jest.Mock).mockImplementation(async ({ data }) => ({
        id: 'phone-guest-id',
        ...data,
      }));

      const payload = {
        guestName: 'Phone Guest',
        email: 'phoneguest@example.com',
        phone: '+1 (555) 123-4567',
        ...basePostalFields,
        notes: 'Gate code 1234',
      };

      const req = new NextRequest('http://localhost/api/guest/address/public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(mockPrisma.invitationCode.create).toHaveBeenCalledTimes(1);

      const createdData = (mockPrisma.invitationCode.create as jest.Mock).mock.calls[0][0].data;
      expect(createdData.guestName).toBe('Phone Guest');
      expect(createdData.dietaryNotes).toBeNull();
      expect(createdData.extraFields).toEqual({
        phone: '+15551234567',
        mobile: '+15551234567',
        householdNotes: 'Gate code 1234',
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
        ...basePostalFields,
      };

      const req = new NextRequest('http://localhost/api/guest/address/public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        ...basePostalFields,
      };

      const req = new NextRequest('http://localhost/api/guest/address/public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        ...basePostalFields,
      };

      const req = new NextRequest('http://localhost/api/guest/address/public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        ...basePostalFields,
      };

      const req = new NextRequest('http://localhost/api/guest/address/public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        ...basePostalFields,
      };

      const req = new NextRequest('http://localhost/api/guest/address/public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        ...basePostalFields,
      };

      const req = new NextRequest('http://localhost/api/guest/address/public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        ...basePostalFields,
      };

      const req1 = new NextRequest('http://localhost/api/guest/address/public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(htmlPayload),
      });
      const res1 = await POST(req1);
      expect(res1.status).toBe(400);

      const req2 = new NextRequest('http://localhost/api/guest/address/public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guestName: 'Valid Guest',
          householdName: 'Household\nInjected',
          ...basePostalFields,
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guestName: "Élodie O'Connor-St. Clair",
          householdName: "O'Connor & Müller-Søren.",
          email: 'elodie@example.com',
          ...basePostalFields,
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
});
