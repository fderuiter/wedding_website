/** @jest-environment node */

jest.mock('@/lib/prisma', () => ({
  prisma: {
    invitationCode: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
  },
}));

import { NextRequest } from 'next/server';
import { POST as lookupRoute } from '../route';
import { prisma } from '@/lib/prisma';
import { resetRateLimitsForTesting } from '@/utils/rateLimit';
import { signGuestToken, GUEST_COOKIE } from '@/core/auth/guest.server';
import {
  signGuestInviteSessionToken,
  verifyGuestInviteSessionToken,
  GUEST_INVITE_COOKIE,
} from '@/core/auth/guestInviteSession';

const mockFindMany = prisma.invitationCode.findMany as jest.Mock;

function extractCookieValue(setCookieHeader: string | null, cookieName: string): string | null {
  if (!setCookieHeader) return null;
  for (const segment of setCookieHeader.split(/,(?=\s*[A-Za-z0-9_-]+=)/)) {
    const firstPair = segment.split(';')[0]?.trim();
    if (!firstPair) continue;
    const eqIdx = firstPair.indexOf('=');
    if (eqIdx > 0 && firstPair.slice(0, eqIdx) === cookieName) {
      return firstPair.slice(eqIdx + 1);
    }
  }
  return null;
}

describe('POST /api/guest/lookup', () => {
  let guestCookieHeader: string;

  beforeEach(async () => {
    jest.clearAllMocks();
    resetRateLimitsForTesting();
    const guestToken = await signGuestToken({ guest: true, exp: Date.now() + 1000 * 60 * 60 });
    guestCookieHeader = `${GUEST_COOKIE}=${guestToken}`;
  });

  describe('Authentication Gate', () => {
    it('returns 401 when caller lacks guest_auth, guest_invite_session, and admin_auth', async () => {
      const req = new NextRequest('http://localhost/api/guest/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName: 'Jane', lastName: 'Doe' }),
      });
      const res = await lookupRoute(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toMatch(/passcode/i);
      expect(mockFindMany).not.toHaveBeenCalled();
      expect(res.headers.get('set-cookie') || '').not.toContain(`${GUEST_INVITE_COOKIE}=`);
    });
  });

  describe('Validation & Multi-Token Name Constraints', () => {
    it('returns 400 if body is invalid JSON', async () => {
      const req = new NextRequest('http://localhost/api/guest/lookup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: guestCookieHeader,
        },
        body: 'invalid-json',
      });
      const res = await lookupRoute(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('Invalid JSON body');
    });

    it('returns 400 if no first and last name are provided', async () => {
      const req = new NextRequest('http://localhost/api/guest/lookup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: guestCookieHeader,
        },
        body: JSON.stringify({}),
      });
      const res = await lookupRoute(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toMatch(/first and last name/i);
    });

    it('returns 400 for single-word surname or first-name queries without querying DB or minting session', async () => {
      for (const payload of [
        { name: 'Vance' },
        { query: 'Samantha' },
        { firstName: 'Jane', lastName: '' },
      ]) {
        const req = new NextRequest('http://localhost/api/guest/lookup', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            cookie: guestCookieHeader,
          },
          body: JSON.stringify(payload),
        });
        const res = await lookupRoute(req);
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.success).toBe(false);
        expect(json.error).toMatch(/first and last name/i);
        expect(res.headers.get('set-cookie') || '').not.toContain(`${GUEST_INVITE_COOKIE}=`);
      }
      expect(mockFindMany).not.toHaveBeenCalled();
    });

    it('returns 400 if disambiguation email is invalid format', async () => {
      const req = new NextRequest('http://localhost/api/guest/lookup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: guestCookieHeader,
        },
        body: JSON.stringify({
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'not-an-email',
        }),
      });
      const res = await lookupRoute(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Invalid email format.');
    });
  });

  describe('Unmatched & Sample Guest Exclusion', () => {
    it('returns 404 with showLookupHelp details when no invitation matches', async () => {
      mockFindMany.mockResolvedValue([]);
      const req = new NextRequest('http://localhost/api/guest/lookup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: guestCookieHeader,
        },
        body: JSON.stringify({ firstName: 'Nonexistent', lastName: 'Guest' }),
      });
      const res = await lookupRoute(req);
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('No invitation found matching');
      expect(json.details).toEqual({ showLookupHelp: true });
      expect(res.headers.get('set-cookie') || '').not.toContain(`${GUEST_INVITE_COOKIE}=`);
    });

    it('excludes sample guest records (isSample: true) and issues no guest_invite_session cookie', async () => {
      mockFindMany.mockResolvedValue([
        {
          id: 'sample-1',
          code: 'SAMPLE01',
          guestName: 'Robert Smith',
          isSample: true,
        },
      ]);

      const req = new NextRequest('http://localhost/api/guest/lookup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: guestCookieHeader,
        },
        body: JSON.stringify({ firstName: 'Robert', lastName: 'Smith' }),
      });
      const res = await lookupRoute(req);
      expect(res.status).toBe(404);
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isSample: false }),
        })
      );
      expect(res.headers.get('set-cookie') || '').not.toContain(`${GUEST_INVITE_COOKIE}=`);
    });
  });

  describe('Scoped Session Minting & Companion Matching', () => {
    it('mints an RSVP-scoped session (scope: rsvp, addressVerified: false) while omitting raw code and street addresses', async () => {
      mockFindMany.mockResolvedValue([
        {
          id: 'inv-uuid-1',
          code: 'PASS1234',
          guestName: 'Jane Doe',
          householdName: 'Doe Household',
          email: 'jane@example.com',
          addressLine1: '123 Secret Street',
          zipCode: '02840',
          dietaryNotes: 'Vegan',
          isSample: false,
        },
      ]);

      const req = new NextRequest('http://localhost/api/guest/lookup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: guestCookieHeader,
        },
        body: JSON.stringify({ firstName: 'jane', lastName: 'doe' }),
      });
      const res = await lookupRoute(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.sessionType).toBe('name_lookup');
      expect(json.guestName).toBe('Jane Doe');
      expect(json.householdName).toBe('Doe Household');
      expect(json.addressVerified).toBe(false);
      expect(json.code).toBeUndefined();
      expect(json.data?.code).toBeUndefined();
      expect(json.addressLine1).toBeUndefined();
      expect(json.data?.addressLine1).toBeUndefined();
      expect(json.dietaryNotes).toBeUndefined();

      const rawSessionToken = extractCookieValue(res.headers.get('set-cookie'), GUEST_INVITE_COOKIE);
      expect(rawSessionToken).toBeTruthy();
      const verifiedPayload = await verifyGuestInviteSessionToken(rawSessionToken!);
      expect(verifiedPayload).toMatchObject({
        code: 'PASS1234',
        guestName: 'Jane Doe',
        scope: 'rsvp',
        addressVerified: false,
      });
    });

    it('preserves full addressVerified scope when caller already holds a verified session for the same invite', async () => {
      (prisma.invitationCode.findFirst as jest.Mock).mockResolvedValue({
        id: 'inv-uuid-1',
        code: 'PASS1234',
        guestName: 'Jane Doe',
        isSample: false,
      });
      mockFindMany.mockResolvedValue([
        {
          id: 'inv-uuid-1',
          code: 'PASS1234',
          guestName: 'Jane Doe',
          householdName: 'Doe Household',
          isSample: false,
        },
      ]);

      const fullSessionToken = await signGuestInviteSessionToken({
        code: 'PASS1234',
        guestName: 'Jane Doe',
        scope: 'full',
        addressVerified: true,
      });

      const req = new NextRequest('http://localhost/api/guest/lookup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `${GUEST_INVITE_COOKIE}=${fullSessionToken}`,
        },
        body: JSON.stringify({ firstName: 'Jane', lastName: 'Doe' }),
      });
      const res = await lookupRoute(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.addressVerified).toBe(true);

      const rawSessionToken = extractCookieValue(res.headers.get('set-cookie'), GUEST_INVITE_COOKIE);
      const verifiedPayload = await verifyGuestInviteSessionToken(rawSessionToken!);
      expect(verifiedPayload).toMatchObject({
        code: 'PASS1234',
        scope: 'full',
        addressVerified: true,
      });
    });

    it('matches multi-token compound plus-one full name and unlocks household RSVP session', async () => {
      mockFindMany.mockResolvedValue([
        {
          id: 'inv-uuid-plus-4',
          code: 'PLUSMULTI',
          guestName: 'Primary Host',
          householdName: 'Host Household',
          plusOneFirstName: 'Mary Jane',
          plusOneLastName: 'Watson',
          isSample: false,
        },
      ]);

      const req = new NextRequest('http://localhost/api/guest/lookup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: guestCookieHeader,
        },
        body: JSON.stringify({ name: 'Mary Jane Watson' }),
      });
      const res = await lookupRoute(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.guestName).toBe('Primary Host');
      expect(json.code).toBeUndefined();

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            isSample: false,
            OR: expect.arrayContaining([
              { guestName: { equals: 'Mary Jane Watson', mode: 'insensitive' } },
              {
                AND: [
                  { plusOneFirstName: { equals: 'Mary', mode: 'insensitive' } },
                  { plusOneLastName: { equals: 'Jane Watson', mode: 'insensitive' } },
                ],
              },
              {
                AND: [
                  { plusOneFirstName: { equals: 'Mary Jane', mode: 'insensitive' } },
                  { plusOneLastName: { equals: 'Watson', mode: 'insensitive' } },
                ],
              },
            ]),
          },
        })
      );
    });
  });

  describe('Duplicate Name Disambiguation', () => {
    const alexNorth = {
      id: 'inv-alex-1',
      code: 'ALEXNRTH',
      guestName: 'Alex Chen',
      householdName: 'Chen North Household',
      email: 'alex.north@example.com',
      zipCode: '02116-1234',
      isSample: false,
    };
    const alexSouth = {
      id: 'inv-alex-2',
      code: 'ALEXSTH1',
      guestName: 'Alex Chen',
      householdName: 'Chen South Household',
      email: 'alex.south@example.com',
      zipCode: '94107',
      isSample: false,
    };

    it('returns 409 requiresDisambiguation when multiple distinct households match without email or zipCode', async () => {
      mockFindMany.mockResolvedValue([alexNorth, alexSouth]);

      const req = new NextRequest('http://localhost/api/guest/lookup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: guestCookieHeader,
        },
        body: JSON.stringify({ firstName: 'Alex', lastName: 'Chen' }),
      });
      const res = await lookupRoute(req);
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.details).toEqual({ requiresDisambiguation: true });
      expect(res.headers.get('set-cookie') || '').not.toContain(`${GUEST_INVITE_COOKIE}=`);
    });

    it('resolves colliding names using 5-digit ZIP prefix or email on household siblings', async () => {
      mockFindMany
        .mockResolvedValueOnce([alexNorth, alexSouth])
        .mockResolvedValueOnce([alexNorth, alexSouth]);

      const zipReq = new NextRequest('http://localhost/api/guest/lookup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: guestCookieHeader,
        },
        body: JSON.stringify({ firstName: 'Alex', lastName: 'Chen', zipCode: '02116' }),
      });
      const zipRes = await lookupRoute(zipReq);
      expect(zipRes.status).toBe(200);
      const zipJson = await zipRes.json();
      expect(zipJson.householdName).toBe('Chen North Household');

      const token = extractCookieValue(zipRes.headers.get('set-cookie'), GUEST_INVITE_COOKIE);
      const payload = await verifyGuestInviteSessionToken(token!);
      expect(payload?.code).toBe('ALEXNRTH');
      expect(payload?.scope).toBe('rsvp');
    });

    it('does not treat duplicate rows within the same householdName as a collision', async () => {
      mockFindMany.mockResolvedValue([
        {
          id: 'inv-same-1',
          code: 'SAMEHH01',
          guestName: 'Robert Smith',
          householdName: 'Smith Family',
          isSample: false,
        },
        {
          id: 'inv-same-2',
          code: 'SAMEHH02',
          guestName: 'Robert Smith',
          householdName: 'Smith Family',
          isSample: false,
        },
      ]);

      const req = new NextRequest('http://localhost/api/guest/lookup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: guestCookieHeader,
        },
        body: JSON.stringify({ firstName: 'Robert', lastName: 'Smith' }),
      });
      const res = await lookupRoute(req);
      expect(res.status).toBe(200);
    });
  });

  describe('Rate Limiting Guardrails', () => {
    it('enforces a maximum of 5 attempts per 15-minute window and returns 429 on the 6th attempt', async () => {
      mockFindMany.mockResolvedValue([]);

      const makeRequest = () =>
        lookupRoute(
          new NextRequest('http://localhost/api/guest/lookup', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-forwarded-for': '198.51.100.42',
              cookie: guestCookieHeader,
            },
            body: JSON.stringify({ firstName: 'Attempt', lastName: 'Test' }),
          })
        );

      for (let i = 1; i <= 5; i++) {
        const res = await makeRequest();
        expect(res.status).toBe(404);
      }

      const rateLimitedRes = await makeRequest();
      expect(rateLimitedRes.status).toBe(429);
      const json = await rateLimitedRes.json();
      expect(json.success).toBe(false);
      expect(json.error).toMatch(/too many requests/i);
    });
  });
});
