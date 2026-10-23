/** @jest-environment node */

import { POST } from '../route';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resetRateLimitsForTesting } from '@/utils/rateLimit';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    invitationCode: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  },
}));

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('Public Address Collection API (/api/guest/address/public)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimitsForTesting();
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
