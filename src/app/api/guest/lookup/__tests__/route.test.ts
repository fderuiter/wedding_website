/** @jest-environment node */

jest.mock('@/lib/prisma', () => ({
  prisma: {
    invitationCode: {
      findFirst: jest.fn(),
    },
  },
}));

import { POST as lookupRoute } from '../route';
import { prisma } from '@/lib/prisma';
import { NextRequest } from 'next/server';
import { resetRateLimitsForTesting } from '@/utils/rateLimit';
import { GUEST_COOKIE } from '@/core/auth/guest.server';
import { GUEST_INVITE_COOKIE } from '@/core/auth/guestInviteSession';

const mockFindFirst = prisma.invitationCode.findFirst as jest.Mock;

describe('POST /api/guest/lookup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimitsForTesting();
  });

  describe('Validation & Constraints', () => {
    it('returns 400 if body is invalid JSON', async () => {
      const req = new NextRequest('http://localhost/api/guest/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid-json',
      });
      const res = await lookupRoute(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('Invalid JSON body');
    });

    it('returns 400 if no search term (name, email, or query) is provided', async () => {
      const req = new NextRequest('http://localhost/api/guest/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const res = await lookupRoute(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Name or email is required.');
    });

    it('returns 400 if name is shorter than 2 characters', async () => {
      const req = new NextRequest('http://localhost/api/guest/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'A' }),
      });
      const res = await lookupRoute(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Name must be at least 2 characters.');
    });

    it('returns 400 if query is shorter than 2 characters for non-email', async () => {
      const req = new NextRequest('http://localhost/api/guest/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'A' }),
      });
      const res = await lookupRoute(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Name must be at least 2 characters.');
    });

    it('returns 400 if email is invalid format', async () => {
      const req = new NextRequest('http://localhost/api/guest/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'not-an-email' }),
      });
      const res = await lookupRoute(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Invalid email format.');
    });

    it('returns 400 if query contains @ but is invalid email format', async () => {
      const req = new NextRequest('http://localhost/api/guest/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'bademail@' }),
      });
      const res = await lookupRoute(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Invalid email format.');
    });
  });

  describe('Unmatched Queries', () => {
    it('returns 404 when no invitation matches the search query', async () => {
      mockFindFirst.mockResolvedValue(null);
      const req = new NextRequest('http://localhost/api/guest/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'Nonexistent Guest' }),
      });
      const res = await lookupRoute(req);
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('No invitation found matching');
    });
  });

  describe('Successful Lookups & Session Hydration', () => {
    it('matches by guest name and sets guest_auth and guest_invite_session cookies', async () => {
      mockFindFirst.mockResolvedValue({
        id: 'inv-uuid-1',
        code: 'PASS123',
        guestName: 'Jane Doe',
        email: 'jane@example.com',
        addressLine1: '123 Secret Street',
        dietaryNotes: 'Vegan',
      });

      const req = new NextRequest('http://localhost/api/guest/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'Jane Doe' }),
      });
      const res = await lookupRoute(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.guestName).toBe('Jane Doe');
      expect(json.code).toBe('PASS123');

      // Minimal public data: should not leak sensitive database fields
      expect(json.addressLine1).toBeUndefined();
      expect(json.dietaryNotes).toBeUndefined();
      expect(json.data.addressLine1).toBeUndefined();

      // Check cookies
      const setCookieHeaders = res.headers.get('set-cookie') || '';
      expect(setCookieHeaders).toContain(`${GUEST_COOKIE}=`);
      expect(setCookieHeaders).toContain(`${GUEST_INVITE_COOKIE}=`);
      expect(setCookieHeaders).toContain('Path=/');
    });

    it('matches by email and sets both session cookies', async () => {
      mockFindFirst.mockResolvedValue({
        id: 'inv-uuid-2',
        code: 'EMAILPASS',
        guestName: 'Alex Smith',
        email: 'alex@example.com',
      });

      const req = new NextRequest('http://localhost/api/guest/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'alex@example.com' }),
      });
      const res = await lookupRoute(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.guestName).toBe('Alex Smith');
      expect(json.code).toBe('EMAILPASS');

      const setCookieHeaders = res.headers.get('set-cookie') || '';
      expect(setCookieHeaders).toContain(`${GUEST_COOKIE}=`);
      expect(setCookieHeaders).toContain(`${GUEST_INVITE_COOKIE}=`);
    });

    it('matches by case-insensitive name or email query', async () => {
      mockFindFirst.mockResolvedValue({
        id: 'inv-uuid-3',
        code: 'CASEPASS',
        guestName: 'Jordan Lee',
        email: 'jordan@example.com',
      });

      const req = new NextRequest('http://localhost/api/guest/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'JORDAN@EXAMPLE.COM' }),
      });
      const res = await lookupRoute(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.guestName).toBe('Jordan Lee');
    });

    it('matches by plus-one first name and authenticates party invitation', async () => {
      mockFindFirst.mockResolvedValue({
        id: 'inv-uuid-plus-1',
        code: 'PLUS1_CODE',
        guestName: 'Primary Guest',
        email: 'primary@example.com',
        plusOneFirstName: 'Cassandra',
        plusOneLastName: 'Vane',
      });

      const req = new NextRequest('http://localhost/api/guest/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'Cassandra' }),
      });
      const res = await lookupRoute(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.guestName).toBe('Primary Guest');
      expect(json.code).toBe('PLUS1_CODE');

      expect(mockFindFirst).toHaveBeenCalledWith({
        where: {
          OR: expect.arrayContaining([
            { plusOneFirstName: { equals: 'Cassandra', mode: 'insensitive' } },
          ]),
        },
      });

      const setCookieHeaders = res.headers.get('set-cookie') || '';
      expect(setCookieHeaders).toContain(`${GUEST_COOKIE}=`);
      expect(setCookieHeaders).toContain(`${GUEST_INVITE_COOKIE}=`);
    });

    it('matches by plus-one last name and authenticates party invitation', async () => {
      mockFindFirst.mockResolvedValue({
        id: 'inv-uuid-plus-2',
        code: 'PLUS2_CODE',
        guestName: 'Primary Guest',
        email: 'primary@example.com',
        plusOneFirstName: 'Cassandra',
        plusOneLastName: 'Vane',
      });

      const req = new NextRequest('http://localhost/api/guest/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Vane' }),
      });
      const res = await lookupRoute(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.guestName).toBe('Primary Guest');
      expect(json.code).toBe('PLUS2_CODE');

      expect(mockFindFirst).toHaveBeenCalledWith({
        where: {
          OR: expect.arrayContaining([
            { plusOneLastName: { equals: 'Vane', mode: 'insensitive' } },
          ]),
        },
      });
    });

    it('matches compound plus-one full name by tokenizing first and last name', async () => {
      mockFindFirst.mockResolvedValue({
        id: 'inv-uuid-plus-3',
        code: 'PLUS3_CODE',
        guestName: 'Primary Guest',
        email: 'primary@example.com',
        plusOneFirstName: 'Cassandra',
        plusOneLastName: 'Vane',
      });

      const req = new NextRequest('http://localhost/api/guest/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'Cassandra Vane' }),
      });
      const res = await lookupRoute(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.guestName).toBe('Primary Guest');
      expect(json.code).toBe('PLUS3_CODE');

      expect(mockFindFirst).toHaveBeenCalledWith({
        where: {
          OR: expect.arrayContaining([
            {
              AND: [
                { plusOneFirstName: { equals: 'Cassandra', mode: 'insensitive' } },
                { plusOneLastName: { equals: 'Vane', mode: 'insensitive' } },
              ],
            },
          ]),
        },
      });
    });

    it('matches compound multi-token plus-one full name with multiple words', async () => {
      mockFindFirst.mockResolvedValue({
        id: 'inv-uuid-plus-4',
        code: 'PLUS4_CODE',
        guestName: 'Primary Guest',
        email: 'primary@example.com',
        plusOneFirstName: 'Mary Jane',
        plusOneLastName: 'Watson',
      });

      const req = new NextRequest('http://localhost/api/guest/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'Mary Jane Watson' }),
      });
      const res = await lookupRoute(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.guestName).toBe('Primary Guest');
      expect(json.code).toBe('PLUS4_CODE');

      expect(mockFindFirst).toHaveBeenCalledWith({
        where: {
          OR: expect.arrayContaining([
            {
              AND: [
                { plusOneFirstName: { equals: 'Mary Jane', mode: 'insensitive' } },
                { plusOneLastName: { equals: 'Watson', mode: 'insensitive' } },
              ],
            },
          ]),
        },
      });
    });

    it('falls back to substring search across guestName, plusOneFirstName, and plusOneLastName when exact match misses', async () => {
      // First call (exact match) returns null; second call (fallback contains) returns invitation
      mockFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
        id: 'inv-uuid-plus-5',
        code: 'PLUS5_CODE',
        guestName: 'Primary Guest',
        email: 'primary@example.com',
        plusOneFirstName: 'Cassandra',
        plusOneLastName: 'Vane',
      });

      const req = new NextRequest('http://localhost/api/guest/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'Cassan' }),
      });
      const res = await lookupRoute(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.guestName).toBe('Primary Guest');
      expect(json.code).toBe('PLUS5_CODE');

      expect(mockFindFirst).toHaveBeenNthCalledWith(2, {
        where: {
          OR: [
            { guestName: { contains: 'Cassan', mode: 'insensitive' } },
            { plusOneFirstName: { contains: 'Cassan', mode: 'insensitive' } },
            { plusOneLastName: { contains: 'Cassan', mode: 'insensitive' } },
          ],
        },
      });
    });
  });

  describe('Rate Limiting Guardrails', () => {
    it('enforces a maximum of 5 attempts per 15-minute window and returns 429 on the 6th attempt', async () => {
      mockFindFirst.mockResolvedValue(null);

      const makeRequest = () =>
        lookupRoute(
          new NextRequest('http://localhost/api/guest/lookup', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-forwarded-for': '198.51.100.42',
            },
            body: JSON.stringify({ query: 'Attempt Test' }),
          })
        );

      // First 5 attempts should return 404 (not 429)
      for (let i = 1; i <= 5; i++) {
        const res = await makeRequest();
        expect(res.status).toBe(404);
      }

      // 6th attempt exceeds rate limit
      const rateLimitedRes = await makeRequest();
      expect(rateLimitedRes.status).toBe(429);
      const json = await rateLimitedRes.json();
      expect(json.success).toBe(false);
      expect(json.error).toMatch(/too many requests/i);
    });
  });
});
