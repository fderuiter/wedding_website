/** @jest-environment node */

jest.mock('@/lib/prisma', () => ({
  prisma: {
    invitationCode: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

import { NextRequest } from 'next/server';
import { POST as verifyRoute } from '../route';
import { GET as getAddressRoute, PUT as putAddressRoute } from '../../route';
import { prisma } from '@/lib/prisma';
import { resetRateLimitsForTesting } from '@/utils/rateLimit';
import {
  GUEST_INVITE_COOKIE,
  signGuestInviteSessionToken,
  verifyGuestInviteSessionToken,
} from '@/core/auth/guestInviteSession';

const mockFindUnique = prisma.invitationCode.findUnique as jest.Mock;
const mockFindMany = prisma.invitationCode.findMany as jest.Mock;

describe('POST /api/guest/address/verify', () => {
  let rsvpScopedCookie: string;

  beforeEach(async () => {
    jest.clearAllMocks();
    resetRateLimitsForTesting();
    const token = await signGuestInviteSessionToken({
      code: 'BENN0001',
      guestName: 'Oliver Bennett',
      scope: 'rsvp',
      addressVerified: false,
    });
    rsvpScopedCookie = `${GUEST_INVITE_COOKIE}=${token}`;
    mockFindUnique.mockResolvedValue({
      id: 'inv-1',
      code: 'BENN0001',
      guestName: 'Oliver Bennett',
      isSample: false,
    });
  });

  it('returns 401 when caller has no guest_invite_session', async () => {
    const req = new NextRequest('http://localhost/api/guest/address/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zipCode: '02840' }),
    });
    const res = await verifyRoute(req);
    expect(res.status).toBe(401);
  });

  it('returns 400 when neither code nor zipCode is provided', async () => {
    const req = new NextRequest('http://localhost/api/guest/address/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: rsvpScopedCookie },
      body: JSON.stringify({}),
    });
    const res = await verifyRoute(req);
    expect(res.status).toBe(400);
  });

  it('verifies a household sibling code or ZIP+4 prefix and upgrades session to full scope', async () => {
    const primary = {
      id: 'inv-1',
      code: 'BENN0001',
      guestName: 'Oliver Bennett',
      householdName: 'Bennett Household',
      addressLine1: '10 Ocean Ave',
      city: 'Newport',
      state: 'RI',
      zipCode: '02840-4412',
      country: 'USA',
      isSample: false,
    };
    const sibling = {
      id: 'inv-2',
      code: 'BENN0002',
      guestName: 'Claire Bennett',
      householdName: 'Bennett Household',
      zipCode: '02840-4412',
      isSample: false,
    };

    mockFindUnique.mockResolvedValue(primary);
    mockFindMany.mockResolvedValue([primary, sibling]);

    // Verify using 5-digit US ZIP matching saved ZIP+4
    const zipReq = new NextRequest('http://localhost/api/guest/address/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: rsvpScopedCookie },
      body: JSON.stringify({ zipCode: '02840' }),
    });
    const zipRes = await verifyRoute(zipReq);
    expect(zipRes.status).toBe(200);
    const zipJson = await zipRes.json();
    expect(zipJson.addressVerified).toBe(true);
    expect(zipJson.data.addressLine1).toBe('10 Ocean Ave');
    expect(zipJson.data.code).toBe('BENN0001');

    const setCookie = zipRes.headers.get('set-cookie') || '';
    const rawUpgraded = setCookie.split(';')[0]?.split('=')[1] || '';
    const payload = await verifyGuestInviteSessionToken(rawUpgraded);
    expect(payload).toMatchObject({
      code: 'BENN0001',
      scope: 'full',
      addressVerified: true,
    });

    // Verify using sibling invitation code
    const codeReq = new NextRequest('http://localhost/api/guest/address/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: rsvpScopedCookie },
      body: JSON.stringify({ code: 'benn0002' }),
    });
    const codeRes = await verifyRoute(codeReq);
    expect(codeRes.status).toBe(200);
  });

  it('rejects wrong ZIP or missing saved ZIP with 401 and keeps session unverified', async () => {
    const noZipRecord = {
      id: 'inv-1',
      code: 'BENN0001',
      guestName: 'Oliver Bennett',
      householdName: null,
      zipCode: null,
      isSample: false,
    };
    mockFindUnique.mockResolvedValue(noZipRecord);

    const req = new NextRequest('http://localhost/api/guest/address/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: rsvpScopedCookie },
      body: JSON.stringify({ zipCode: '02840' }),
    });
    const res = await verifyRoute(req);
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie') || '').not.toContain(`${GUEST_INVITE_COOKIE}=`);
  });

  it('blocks GET and PUT /api/guest/address when session is rsvp-scoped (addressVerified=false) without reading or overwriting street addresses', async () => {
    const getReq = new NextRequest('http://localhost/api/guest/address', {
      method: 'GET',
      headers: { cookie: rsvpScopedCookie },
    });
    const getRes = await getAddressRoute(getReq);
    expect(getRes.status).toBe(401);
    const getJson = await getRes.json();
    expect(getJson.details).toEqual({
      requiresAddressVerification: true,
      guestName: 'Oliver Bennett',
    });
    expect(getJson.data).toBeUndefined();

    const putReq = new NextRequest('http://localhost/api/guest/address', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie: rsvpScopedCookie },
      body: JSON.stringify({
        addressLine1: '99 Intruder Rd',
        city: 'Newport',
        state: 'RI',
        zipCode: '02840',
      }),
    });
    const putRes = await putAddressRoute(putReq);
    expect(putRes.status).toBe(401);
    const putJson = await putRes.json();
    expect(putJson.details).toEqual({
      requiresAddressVerification: true,
      guestName: 'Oliver Bennett',
    });
  });
});
