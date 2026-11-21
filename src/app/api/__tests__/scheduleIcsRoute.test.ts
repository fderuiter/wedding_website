/** @jest-environment node */

import { NextRequest } from 'next/server';
import { GET } from '../schedule/ics/route';
import {
  GUEST_INVITE_COOKIE,
  signGuestInviteSessionToken,
  signGuestItineraryToken,
} from '@/core/auth/guestInviteSession';
import { subEventService } from '@/features/sub-events';
import { getAppConfig } from '@/lib/config';
import { prisma } from '@/lib/prisma';

jest.mock('@/features/sub-events/service');
jest.mock('@/lib/config');
jest.mock('@/lib/prisma', () => ({
  prisma: {
    invitationCode: {
      findUnique: jest.fn(),
    },
  },
}));

describe('GET /api/schedule/ics Route', () => {
  const mockGetScheduleForGuest = subEventService.getScheduleForGuest as jest.MockedFunction<
    typeof subEventService.getScheduleForGuest
  >;
  const mockGetAppConfig = getAppConfig as jest.MockedFunction<typeof getAppConfig>;
  const mockInviteFindUnique = (prisma as any).invitationCode.findUnique as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetScheduleForGuest.mockReset();
    mockGetAppConfig.mockReset();
    mockInviteFindUnique.mockReset();
    mockGetAppConfig.mockResolvedValue({
      timezone: 'America/Chicago',
    } as any);
  });

  it('returns 401 Unauthorized when neither guest session cookie nor signed token is provided', async () => {
    const req = new NextRequest('http://localhost:3000/api/schedule/ics');
    const res = await GET(req, {});
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.success).toBe(false);
    expect(json.error).toMatch(/Unauthorized/i);
    expect(mockGetScheduleForGuest).not.toHaveBeenCalled();
  });

  it('returns 401 Unauthorized when signed token is forged, expired, or points to a sample/missing invite', async () => {
    const forgedReq = new NextRequest('http://localhost:3000/api/schedule/ics?token=forged.token');
    const forgedRes = await GET(forgedReq, {});
    expect(forgedRes.status).toBe(401);

    const expiredToken = await signGuestItineraryToken({
      code: 'GUEST1',
      guestName: 'Jane Smith',
      iat: Date.now() - 10_000,
      exp: Date.now() - 1_000,
    });
    const expiredReq = new NextRequest(
      `http://localhost:3000/api/schedule/ics?token=${encodeURIComponent(expiredToken)}`
    );
    const expiredRes = await GET(expiredReq, {});
    expect(expiredRes.status).toBe(401);

    mockInviteFindUnique.mockResolvedValue(null);
    const revokedToken = await signGuestItineraryToken({
      code: 'REVOKED1',
      guestName: 'Revoked Guest',
    });
    const revokedReq = new NextRequest(
      `http://localhost:3000/api/schedule/ics?token=${encodeURIComponent(revokedToken)}`
    );
    const revokedRes = await GET(revokedReq, {});
    expect(revokedRes.status).toBe(401);
  });

  it('returns 404 when the authenticated guest has no attending events', async () => {
    mockInviteFindUnique.mockResolvedValue({
      code: 'GUEST1',
      guestName: 'Jane Smith',
      isSample: false,
    });
    const cookieToken = await signGuestInviteSessionToken({
      code: 'GUEST1',
      guestName: 'Jane Smith',
    });

    mockGetScheduleForGuest.mockResolvedValue([
      {
        id: 'se-1',
        title: 'Ceremony',
        isPrivate: false,
        isReadOnly: false,
        userRsvp: { status: 'declined', plusOneCount: 0, dietaryNotes: '' },
      },
      {
        id: 'se-2',
        title: 'Reception',
        isPrivate: false,
        isReadOnly: false,
        userRsvp: { status: 'pending', plusOneCount: 0, dietaryNotes: '' },
      },
    ]);

    const req = new NextRequest('http://localhost:3000/api/schedule/ics', {
      headers: {
        cookie: `${GUEST_INVITE_COOKIE}=${cookieToken}`,
      },
    });
    const res = await GET(req, {});
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toMatch(/No attending events/i);
  });

  it('serves a valid multi-event RFC 5545 .ics file for cookie-authenticated guests containing only attending events', async () => {
    mockInviteFindUnique.mockResolvedValue({
      code: 'GUEST1',
      guestName: 'Jane Smith',
      isSample: false,
    });
    const cookieToken = await signGuestInviteSessionToken({
      code: 'GUEST1',
      guestName: 'Jane Smith',
    });

    mockGetScheduleForGuest.mockResolvedValue([
      {
        id: 'se-welcome',
        title: 'Welcome Drinks',
        startTime: '2026-06-19T23:00:00.000Z',
        endTime: '2026-06-20T01:00:00.000Z',
        locationName: 'Rooftop Lounge',
        description: 'Kickoff toast',
        isPrivate: true,
        isReadOnly: false,
        userRsvp: { status: 'attending', plusOneCount: 1, dietaryNotes: 'Gluten-free' },
      },
      {
        id: 'se-ceremony',
        title: 'Main Ceremony',
        startTime: '2026-06-20T20:30:00.000Z',
        endTime: '2026-06-20T21:30:00.000Z',
        locationName: 'Oak Garden',
        description: 'Vows',
        isPrivate: false,
        isReadOnly: false,
        userRsvp: { status: 'attending', plusOneCount: 1, dietaryNotes: '' },
      },
      {
        id: 'se-brunch',
        title: 'Farewell Brunch',
        startTime: '2026-06-21T15:00:00.000Z',
        endTime: '2026-06-21T17:00:00.000Z',
        locationName: 'Patio',
        isPrivate: false,
        isReadOnly: false,
        userRsvp: { status: 'declined', plusOneCount: 0, dietaryNotes: '' },
      },
    ]);

    const req = new NextRequest('http://localhost:3000/api/schedule/ics', {
      headers: {
        cookie: `${GUEST_INVITE_COOKIE}=${cookieToken}`,
      },
    });
    const res = await GET(req, {});
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');
    expect(res.headers.get('Content-Disposition')).toBe(
      'attachment; filename="wedding-itinerary.ics"'
    );
    expect(body).toContain('BEGIN:VCALENDAR');
    expect(body).toContain('TZID:America/Chicago');
    expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(body).toContain('SUMMARY:Welcome Drinks');
    expect(body).toContain('SUMMARY:Main Ceremony');
    expect(body).not.toContain('Farewell Brunch');
  });

  it('serves the combined .ics itinerary via signed query token without requiring browser cookies', async () => {
    mockInviteFindUnique.mockResolvedValue({
      code: 'EMAILGUEST',
      guestName: 'Alex Rivera',
      isSample: false,
    });
    const itineraryToken = await signGuestItineraryToken({
      code: 'EMAILGUEST',
      guestName: 'Alex Rivera',
    });

    mockGetScheduleForGuest.mockResolvedValue([
      {
        id: 'se-ceremony',
        title: 'Wedding Ceremony',
        startTime: '2026-06-20T20:30:00.000Z',
        endTime: '2026-06-20T21:30:00.000Z',
        locationName: 'Oak Garden',
        isPrivate: false,
        isReadOnly: false,
        userRsvp: { status: 'attending', plusOneCount: 0, dietaryNotes: '' },
      },
    ]);

    const req = new NextRequest(
      `http://localhost:3000/api/schedule/ics?token=${encodeURIComponent(itineraryToken)}`
    );
    const res = await GET(req, {});
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(mockGetScheduleForGuest).toHaveBeenCalledWith('EMAILGUEST');
    expect(body).toContain('SUMMARY:Wedding Ceremony');
    expect(body).toContain('DTSTART;TZID=America/Chicago:20260620T153000');
  });
});
