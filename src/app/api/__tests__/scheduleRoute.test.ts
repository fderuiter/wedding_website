import { GET } from '../schedule/route';
import { NextRequest } from 'next/server';
import { getGuestInviteSession } from '@/core/auth/guestInviteSession';
import { subEventService } from '@/features/sub-events/service';

jest.mock('@/core/auth/guestInviteSession');
jest.mock('@/features/sub-events/service');

describe('GET /api/schedule Route', () => {
  const mockGetGuestInviteSession = getGuestInviteSession as jest.MockedFunction<typeof getGuestInviteSession>;
  const mockGetScheduleForGuest = subEventService.getScheduleForGuest as jest.MockedFunction<typeof subEventService.getScheduleForGuest>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns public sub-events for unauthenticated visitors', async () => {
    mockGetGuestInviteSession.mockResolvedValue(null);
    mockGetScheduleForGuest.mockResolvedValue([
      { id: '1', title: 'Main Ceremony', isPrivate: false, userRsvp: null },
    ]);

    const req = new NextRequest('http://localhost:3000/api/schedule');
    const res = await GET(req, {});
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(1);
    expect(json.data[0].title).toBe('Main Ceremony');
    expect(json.isGuest).toBe(false);
    expect(mockGetScheduleForGuest).toHaveBeenCalledWith(undefined);
  });

  it('returns public plus private sub-events for authenticated guests', async () => {
    mockGetGuestInviteSession.mockResolvedValue({
      code: 'GUESTCODE1',
      guestName: 'Jane Smith',
    });
    mockGetScheduleForGuest.mockResolvedValue([
      { id: '1', title: 'Main Ceremony', isPrivate: false, userRsvp: null },
      { id: '2', title: 'Rehearsal Dinner', isPrivate: true, userRsvp: { status: 'attending', plusOneCount: 1, dietaryNotes: '' } },
    ]);

    const req = new NextRequest('http://localhost:3000/api/schedule');
    const res = await GET(req, {});
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(2);
    expect(json.isGuest).toBe(true);
    expect(json.guestName).toBe('Jane Smith');
    expect(mockGetScheduleForGuest).toHaveBeenCalledWith('GUESTCODE1');
  });
});
