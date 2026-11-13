import { GET } from '../route';
import { NextRequest } from 'next/server';
import { getGuestInviteSession } from '@/core/auth/guestInviteSession';
import { subEventService } from '@/features/sub-events/service';
import { getAppConfig } from '@/lib/config';
import { ApiError } from '@/utils/ApiError';

jest.mock('@/core/auth/guestInviteSession');
jest.mock('@/features/sub-events/service');
jest.mock('@/lib/config');

describe('GET /api/schedule/[id]/ics Route', () => {
  const mockGetGuestInviteSession = getGuestInviteSession as jest.MockedFunction<typeof getGuestInviteSession>;
  const mockGetSubEventByIdForGuest = subEventService.getSubEventByIdForGuest as jest.MockedFunction<typeof subEventService.getSubEventByIdForGuest>;
  const mockGetAppConfig = getAppConfig as jest.MockedFunction<typeof getAppConfig>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAppConfig.mockResolvedValue({
      timezone: 'America/New_York',
    } as any);
  });

  it('returns valid RFC 5545 .ics calendar content for a public sub-event', async () => {
    mockGetGuestInviteSession.mockResolvedValue(null);
    mockGetSubEventByIdForGuest.mockResolvedValue({
      id: 'se-ceremony',
      title: 'Main Ceremony',
      description: 'The wedding ceremony',
      startTime: '2026-06-20T15:00:00.000Z',
      endTime: '2026-06-20T16:00:00.000Z',
      locationName: 'Grace Church',
      location: '123 Church St',
      category: 'Ceremony',
      isPrivate: false,
      attireRules: 'Formal Black Tie Optional',
      userRsvp: null,
    });

    const req = new NextRequest('http://localhost:3000/api/schedule/se-ceremony/ics');
    const res = await GET(req, { params: Promise.resolve({ id: 'se-ceremony' }) });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/calendar; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="Main Ceremony.ics"');

    const icsContent = await res.text();
    expect(icsContent).toContain('BEGIN:VCALENDAR');
    expect(icsContent).toContain('VERSION:2.0');
    expect(icsContent).toContain('BEGIN:VTIMEZONE');
    expect(icsContent).toContain('TZID:America/New_York');
    expect(icsContent).toContain('BEGIN:VEVENT');
    expect(icsContent).toContain('SUMMARY:Main Ceremony');
    expect(icsContent).toContain('LOCATION:Grace Church');
    expect(icsContent).toContain('Attire: Formal Black Tie Optional');
    expect(icsContent).toContain('END:VEVENT');
    expect(icsContent).toContain('END:VCALENDAR');

    expect(mockGetSubEventByIdForGuest).toHaveBeenCalledWith('se-ceremony', undefined);
  });

  it('returns valid .ics for private sub-event when accessed by authorized guest session', async () => {
    mockGetGuestInviteSession.mockResolvedValue({
      code: 'VIPGUEST',
      guestName: 'Alice Smith',
    });
    mockGetSubEventByIdForGuest.mockResolvedValue({
      id: 'se-rehearsal',
      title: 'Rehearsal Dinner',
      description: 'Private bridal party rehearsal dinner',
      startTime: '2026-06-19T18:00:00.000Z',
      endTime: '2026-06-19T21:00:00.000Z',
      locationName: 'The River Club',
      isPrivate: true,
      attireRules: 'Cocktail',
      userRsvp: { status: 'attending', plusOneCount: 1, dietaryNotes: '' },
    });

    const req = new NextRequest('http://localhost:3000/api/schedule/se-rehearsal/ics');
    const res = await GET(req, { params: { id: 'se-rehearsal' } });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/calendar; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="Rehearsal Dinner.ics"');

    const icsContent = await res.text();
    expect(icsContent).toContain('SUMMARY:Rehearsal Dinner');
    expect(icsContent).toContain('LOCATION:The River Club');
    expect(mockGetSubEventByIdForGuest).toHaveBeenCalledWith('se-rehearsal', 'VIPGUEST');
  });

  it('returns 403 Forbidden for unauthorized access to private sub-event', async () => {
    mockGetGuestInviteSession.mockResolvedValue(null);
    mockGetSubEventByIdForGuest.mockRejectedValue(
      new ApiError(403, 'Forbidden: You do not have access to private event "Rehearsal Dinner".')
    );

    const req = new NextRequest('http://localhost:3000/api/schedule/se-rehearsal/ics');
    const res = await GET(req, { params: Promise.resolve({ id: 'se-rehearsal' }) });

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain('Forbidden');
  });

  it('returns 404 Not Found when sub-event does not exist', async () => {
    mockGetGuestInviteSession.mockResolvedValue(null);
    mockGetSubEventByIdForGuest.mockRejectedValue(
      new ApiError(404, 'Sub-event with ID non-existent not found.')
    );

    const req = new NextRequest('http://localhost:3000/api/schedule/non-existent/ics');
    const res = await GET(req, { params: Promise.resolve({ id: 'non-existent' }) });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain('Sub-event with ID non-existent not found.');
  });

  it('sanitizes quotes in event title for Content-Disposition header', async () => {
    mockGetGuestInviteSession.mockResolvedValue(null);
    mockGetSubEventByIdForGuest.mockResolvedValue({
      id: 'se-fun',
      title: 'The "Grand" Gala',
      startTime: '2026-06-20T19:00:00.000Z',
      endTime: '2026-06-20T23:00:00.000Z',
      isPrivate: false,
    });

    const req = new NextRequest('http://localhost:3000/api/schedule/se-fun/ics');
    const res = await GET(req, { params: { id: 'se-fun' } });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="The Grand Gala.ics"');
  });
});
