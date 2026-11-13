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
  });

  test('creates new InvitationCode with partyTags ["address-collection"] on valid submission', async () => {
    (mockPrisma.invitationCode.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.invitationCode.create as jest.Mock).mockImplementation(async ({ data }) => ({
      id: 'generated-id-1',
      ...data,
    }));

    const payload = {
      guestName: 'Jane Prospect',
      email: 'jane@example.com',
      addressLine1: '789 Oak Ave',
      city: 'Austin',
      state: 'TX',
      zipCode: '78701',
      country: 'United States',
      notes: 'Family of 3',
    };

    const req = new NextRequest('http://localhost/api/guest/address/public', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toBe('Address submitted successfully.');

    expect(mockPrisma.invitationCode.create).toHaveBeenCalledTimes(1);
    const createdData = (mockPrisma.invitationCode.create as jest.Mock).mock.calls[0][0].data;
    expect(createdData.guestName).toBe('Jane Prospect');
    expect(createdData.partyTags).toEqual(['address-collection']);
    expect(createdData.addressLine1).toBe('789 Oak Ave');
    expect(createdData.dietaryNotes).toBe('Family of 3');
  });

  test('matches existing record by normalized email and updates address in place', async () => {
    const existingRecord = {
      id: 'existing-guest-1',
      code: 'ORIG1234',
      guestName: 'Jane Original',
      email: 'jane@example.com',
      addressLine1: '100 Old Rd',
      addressLine2: null,
      city: 'Old Town',
      state: 'TX',
      zipCode: '75001',
      country: 'USA',
      householdName: 'Original Household',
      dietaryNotes: null,
      partyTags: ['VIP'],
      used: false,
    };

    (mockPrisma.invitationCode.findFirst as jest.Mock).mockResolvedValue(existingRecord);
    (mockPrisma.invitationCode.update as jest.Mock).mockImplementation(async ({ data }) => ({
      ...existingRecord,
      ...data,
    }));

    const payload = {
      guestName: 'Jane Prospect',
      email: '  JANE@EXAMPLE.COM  ',
      addressLine1: '789 Oak Ave',
      addressLine2: 'Apt 4B',
      city: 'Austin',
      state: 'TX',
      zipCode: '78701',
      country: 'United States',
      notes: 'Gluten free',
    };

    const req = new NextRequest('http://localhost/api/guest/address/public', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('existing-guest-1');
    expect(body.data.code).toBe('ORIG1234'); // Retains original code!
    expect(body.data.partyTags).toEqual(['VIP', 'address-collection']);

    expect(mockPrisma.invitationCode.findFirst).toHaveBeenCalledWith({
      where: {
        email: {
          equals: 'JANE@EXAMPLE.COM',
          mode: 'insensitive',
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    expect(mockPrisma.invitationCode.create).not.toHaveBeenCalled();
    expect(mockPrisma.invitationCode.update).toHaveBeenCalledTimes(1);
    expect(mockPrisma.invitationCode.update).toHaveBeenCalledWith({
      where: { id: 'existing-guest-1' },
      data: {
        addressLine1: '789 Oak Ave',
        addressLine2: 'Apt 4B',
        city: 'Austin',
        state: 'TX',
        zipCode: '78701',
        country: 'United States',
        householdName: 'Original Household',
        email: 'JANE@EXAMPLE.COM',
        dietaryNotes: 'Gluten free',
        partyTags: ['VIP', 'address-collection'],
      },
    });
  });

  test('matches existing record by normalized guest name when email does not match', async () => {
    const existingRecord = {
      id: 'existing-guest-2',
      code: 'NAME5678',
      guestName: 'John Doe',
      email: 'john.old@example.com',
      addressLine1: null,
      addressLine2: null,
      city: null,
      state: null,
      zipCode: null,
      country: null,
      householdName: null,
      dietaryNotes: null,
      partyTags: [],
      used: false,
    };

    (mockPrisma.invitationCode.findFirst as jest.Mock)
      .mockResolvedValueOnce(null) // Email lookup returns null
      .mockResolvedValueOnce(existingRecord); // Name lookup returns existing record
    (mockPrisma.invitationCode.update as jest.Mock).mockImplementation(async ({ data }) => ({
      ...existingRecord,
      ...data,
    }));

    const payload = {
      guestName: '  john doe  ',
      email: 'newemail@example.com',
      addressLine1: '123 Pine St',
      city: 'Seattle',
      state: 'WA',
      zipCode: '98101',
      country: 'United States',
    };

    const req = new NextRequest('http://localhost/api/guest/address/public', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('existing-guest-2');
    expect(body.data.code).toBe('NAME5678');
    expect(body.data.partyTags).toEqual(['address-collection']);

    expect(mockPrisma.invitationCode.findFirst).toHaveBeenNthCalledWith(1, {
      where: {
        email: {
          equals: 'newemail@example.com',
          mode: 'insensitive',
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    expect(mockPrisma.invitationCode.findFirst).toHaveBeenNthCalledWith(2, {
      where: {
        guestName: {
          equals: 'john doe',
          mode: 'insensitive',
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    expect(mockPrisma.invitationCode.create).not.toHaveBeenCalled();
    expect(mockPrisma.invitationCode.update).toHaveBeenCalledTimes(1);
    expect(mockPrisma.invitationCode.update).toHaveBeenCalledWith({
      where: { id: 'existing-guest-2' },
      data: {
        addressLine1: '123 Pine St',
        addressLine2: null,
        city: 'Seattle',
        state: 'WA',
        zipCode: '98101',
        country: 'United States',
        householdName: null,
        email: 'newemail@example.com',
        dietaryNotes: null,
        partyTags: ['address-collection'],
      },
    });
  });

  test('appends new notes to existing non-empty dietary notes without overwriting', async () => {
    const existingRecord = {
      id: 'existing-guest-3',
      code: 'DIET1111',
      guestName: 'Alice Smith',
      email: 'alice@example.com',
      addressLine1: '1 First Ave',
      dietaryNotes: 'Vegetarian',
      partyTags: ['address-collection'],
      used: false,
    };

    (mockPrisma.invitationCode.findFirst as jest.Mock).mockResolvedValue(existingRecord);
    (mockPrisma.invitationCode.update as jest.Mock).mockImplementation(async ({ data }) => ({
      ...existingRecord,
      ...data,
    }));

    const payload = {
      guestName: 'Alice Smith',
      email: 'alice@example.com',
      addressLine1: '2 Second Ave',
      notes: 'No shellfish',
    };

    const req = new NextRequest('http://localhost/api/guest/address/public', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    expect(mockPrisma.invitationCode.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dietaryNotes: 'Vegetarian\nNo shellfish',
          partyTags: ['address-collection'], // Deduplicated, not repeated
        }),
      })
    );
  });

  test('preserves existing non-empty dietary notes when submission has empty notes', async () => {
    const existingRecord = {
      id: 'existing-guest-4',
      code: 'DIET2222',
      guestName: 'Bob Brown',
      email: 'bob@example.com',
      addressLine1: '5 Elm St',
      dietaryNotes: 'Peanut allergy',
      partyTags: ['Friend'],
      used: false,
    };

    (mockPrisma.invitationCode.findFirst as jest.Mock).mockResolvedValue(existingRecord);
    (mockPrisma.invitationCode.update as jest.Mock).mockImplementation(async ({ data }) => ({
      ...existingRecord,
      ...data,
    }));

    const payload = {
      guestName: 'Bob Brown',
      email: 'bob@example.com',
      addressLine1: '10 Maple St',
      // No notes provided
    };

    const req = new NextRequest('http://localhost/api/guest/address/public', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    expect(mockPrisma.invitationCode.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dietaryNotes: 'Peanut allergy',
          partyTags: ['Friend', 'address-collection'],
        }),
      })
    );
  });

  test('does not duplicate dietary notes if existing note already contains new note', async () => {
    const existingRecord = {
      id: 'existing-guest-5',
      code: 'DIET3333',
      guestName: 'Charlie Green',
      email: 'charlie@example.com',
      dietaryNotes: 'Vegan',
      partyTags: ['address-collection'],
      used: false,
    };

    (mockPrisma.invitationCode.findFirst as jest.Mock).mockResolvedValue(existingRecord);
    (mockPrisma.invitationCode.update as jest.Mock).mockImplementation(async ({ data }) => ({
      ...existingRecord,
      ...data,
    }));

    const payload = {
      guestName: 'Charlie Green',
      email: 'charlie@example.com',
      notes: 'Vegan',
    };

    const req = new NextRequest('http://localhost/api/guest/address/public', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    expect(mockPrisma.invitationCode.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dietaryNotes: 'Vegan',
        }),
      })
    );
  });

  test('sets dietary notes when existing record had null dietary notes', async () => {
    const existingRecord = {
      id: 'existing-guest-6',
      code: 'DIET4444',
      guestName: 'Diana Prince',
      email: 'diana@example.com',
      dietaryNotes: null,
      partyTags: ['VIP', 'address-collection'],
      used: false,
    };

    (mockPrisma.invitationCode.findFirst as jest.Mock).mockResolvedValue(existingRecord);
    (mockPrisma.invitationCode.update as jest.Mock).mockImplementation(async ({ data }) => ({
      ...existingRecord,
      ...data,
    }));

    const payload = {
      guestName: 'Diana Prince',
      email: 'diana@example.com',
      notes: 'Halal',
    };

    const req = new NextRequest('http://localhost/api/guest/address/public', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    expect(mockPrisma.invitationCode.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dietaryNotes: 'Halal',
          partyTags: ['VIP', 'address-collection'],
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
});
